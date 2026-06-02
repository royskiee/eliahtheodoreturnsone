// =========================================================
//  STORYBOOK ENGINE
// =========================================================
(function(){
  'use strict';

  // ====== RSVP endpoint — Apps Script Web App URL (/exec) ======
  // The Sheet behind this endpoint is the source of truth for the
  // guest list. Deleting a row in the Sheet hides that guest on
  // the site (next page load).
  const RSVP_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzG1JcpbVq2iU5YvG9sfikKIp59ofp0-dKwwtdG6v7SWlLDu8N1ntGJ-TpVKZJH14-a/exec';

  // 12 spreads total: 0 = cover, 1-11 = content spreads
  const TOTAL_SPREADS = 12;
  const SPREAD_NAMES = [
    'Cover',
    'Contents',
    'Once Upon a Time',
    'About Elijah',
    'Our Memories',
    'The Details',
    "The Day's Story",
    'Finding Us',
    'The Guest List',
    'Questions',
    'Kindly Respond',
    'The End'
  ];

  let currentSpread = 0;
  let isFlipping = false;
  // Mobile-only: TOC (spread 1) splits into two tap-through sub-pages —
  // the contents list, then the cover photo. false = list, true = photo.
  let tocMobilePhoto = false;
  const FLIP_DURATION = 1100; // ms — matches CSS

  const book = document.getElementById('book');
  const basePageLeft = document.getElementById('basePageLeft');
  const basePageRight = document.getElementById('basePageRight');
  const coverLeaf = document.getElementById('coverLeaf');
  const coverFront = document.getElementById('coverFront');
  const coverBack = document.getElementById('coverBack');
  const navPrev = document.getElementById('navPrev');
  const navNext = document.getElementById('navNext');
  const spreadIndicator = document.getElementById('spreadIndicator');
  const edgeLeft = document.getElementById('edgeLeft');
  const edgeRight = document.getElementById('edgeRight');
  const rightZone = document.querySelector('.leaves .right-zone');
  const chapterIndex = document.getElementById('chapterIndex');

  // Get template by id
  function tpl(id){
    const t = document.getElementById(id);
    return t ? t.content.cloneNode(true) : null;
  }

  // Detect mobile (matches CSS breakpoint 640px)
  function isMobile(){
    return window.matchMedia('(max-width: 640px)').matches;
  }

  // Build the cover front
  function buildCoverFront(){
    const c = tpl('tpl-cover-front');
    if (c) coverFront.appendChild(c);
  }

  // Build the stacked-mobile content for a spread (left + divider + right)
  function buildMobileSpread(spreadIdx){
    const wrap = document.createDocumentFragment();
    const leftTpl = tpl(`tpl-spread-${spreadIdx}-left`);
    const rightTpl = tpl(`tpl-spread-${spreadIdx}-right`);

    // TOC spread (1): on mobile, render only ONE sub-page at a time — the
    // contents list OR the cover photo — so the photo is reached by tapping
    // Next (no scrolling). tocMobilePhoto picks which one. CSS (.toc-split)
    // makes the single section fill the screen.
    if (spreadIdx === 1){
      const which = tocMobilePhoto ? rightTpl : leftTpl;
      if (which){
        const s = document.createElement('div');
        s.className = 'msnap-page';
        s.appendChild(which);
        wrap.appendChild(s);
      }
      return wrap;
    }

    if (leftTpl) wrap.appendChild(leftTpl);
    // Divider only if both halves exist
    if (leftTpl && rightTpl){
      const div = document.createElement('div');
      div.className = 'mobile-divider';
      wrap.appendChild(div);
    }
    if (rightTpl) wrap.appendChild(rightTpl);
    return wrap;
  }

  // Build a spread's left/right pages into containers (desktop) or stacked (mobile)
  function buildSpreadPages(spreadIdx, leftEl, rightEl){
    if (spreadIdx === 0) return;
    leftEl.innerHTML = '';
    rightEl.innerHTML = '';

    if (isMobile()){
      // On mobile, stack everything into the right container (left is hidden)
      rightEl.appendChild(buildMobileSpread(spreadIdx));
      rightEl.classList.toggle('toc-split', spreadIdx === 1);
    } else {
      const leftTpl = tpl(`tpl-spread-${spreadIdx}-left`);
      const rightTpl = tpl(`tpl-spread-${spreadIdx}-right`);
      if (leftTpl) leftEl.appendChild(leftTpl);
      if (rightTpl) rightEl.appendChild(rightTpl);
    }
  }

  // Update the base pages to show a given spread (content only — does NOT bind interactions)
  function setBasePages(spreadIdx, opts){
    opts = opts || {};
    if (spreadIdx === 0){
      basePageLeft.innerHTML = '';
      basePageRight.innerHTML = '';
      return;
    }
    buildSpreadPages(spreadIdx, basePageLeft, basePageRight);
    if (isMobile()) basePageRight.scrollTop = 0;
    if (opts.bind !== false) bindSpreadInteractions(spreadIdx);
  }

  // Update the cover-back face to show spread 1 content
  function setCoverBack(){
    coverBack.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'toc-content';
    if (isMobile()){
      wrap.appendChild(buildMobileSpread(1));
    } else {
      const leftTpl = tpl('tpl-spread-1-left');
      if (leftTpl) wrap.appendChild(leftTpl);
    }
    coverBack.appendChild(wrap);
    bindTocLinks();
  }

  // Bind TOC clicks
  function bindTocLinks(){
    document.querySelectorAll('.toc-jump').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = parseInt(a.dataset.target, 10);
        if (!isNaN(target)) goTo(target);
      });
    });
  }

  // ====== Photo carousel (on spread 2) ======
  let photoCarouselTimer = null;
  function bindPhotoCarousel(){
    const slots = document.querySelectorAll('#basePageRight .photo-slot');
    const dots = document.querySelectorAll('#basePageRight .photo-dots .pd');
    if (slots.length === 0) return;

    let curr = 0;
    function show(i){
      i = ((i % slots.length) + slots.length) % slots.length;
      slots.forEach((s, idx) => s.classList.toggle('active', idx === i));
      dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
      curr = i;
    }
    dots.forEach((d, idx) => d.addEventListener('click', () => show(idx)));
    if (photoCarouselTimer) clearInterval(photoCarouselTimer);
    photoCarouselTimer = setInterval(() => show(curr + 1), 5000);
  }
  function stopPhotoCarousel(){
    if (photoCarouselTimer){ clearInterval(photoCarouselTimer); photoCarouselTimer = null; }
  }

  // ====== Venue photo 3D tilt (mobile, the Setting spread) ======
  // Gyroscope drives a live parallax tilt so the photos pop off the page.
  // iOS 13+ gates motion behind a tap, so we show a one-time chip; if the
  // user denies (or there's no gyro) we fall back to a scroll-linked tilt.
  let venueTilt = null;
  function clampN(v, min, max){ return v < min ? min : (v > max ? max : v); }
  function stopVenueTilt(){
    if (venueTilt){ venueTilt.dispose(); venueTilt = null; }
  }
  function startVenueTilt(){
    stopVenueTilt();
    if (!isMobile()) return;
    const scroller = basePageRight;
    const photos = Array.from(scroller.querySelectorAll('.venue-photo-main, .venue-photo-secondary'));
    if (!photos.length) return;

    scroller.classList.add('venue-tilt-live');

    // Eased angles, shared across the photos (rAF lerps current → target).
    let tgX = 0, tgY = 0, curX = 0, curY = 0, running = true, raf = 0;
    function loop(){
      if (!running) return;
      curX += (tgX - curX) * 0.12;
      curY += (tgY - curY) * 0.12;
      const t = 'perspective(1100px) rotateX(' + curX.toFixed(2) + 'deg) rotateY(' +
                curY.toFixed(2) + 'deg) translateY(-3px) scale(1.015)';
      for (let i = 0; i < photos.length; i++) photos[i].style.transform = t;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    let orientHandler = null, scrollHandler = null, chip = null;
    function attachGyro(){
      orientHandler = function(e){
        const g = e.gamma == null ? 0 : e.gamma;  // left/right tilt [-90,90]
        const b = e.beta  == null ? 45 : e.beta;  // front/back tilt [-180,180]
        tgY = clampN(g, -28, 28) * 0.32;           // follow left/right
        tgX = clampN(45 - b, -28, 28) * 0.30;      // follow front/back (45° = neutral hold)
      };
      window.addEventListener('deviceorientation', orientHandler, true);
    }
    function attachScroll(){
      scrollHandler = function(){
        const sr = scroller.getBoundingClientRect();
        const r = photos[0].getBoundingClientRect();
        const off = (r.top + r.height / 2) - (sr.top + sr.height / 2);
        tgX = clampN(-off / sr.height * 16, -10, 10);
        tgY = 0;
      };
      scroller.addEventListener('scroll', scrollHandler, { passive: true });
      scrollHandler();
    }

    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function'){
      // iOS 13+ — motion needs an explicit tap to grant.
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'venue-tilt-chip';
      chip.textContent = '✦ Tilt to explore';
      photos[0].appendChild(chip);
      chip.addEventListener('click', function(ev){
        ev.stopPropagation();
        DOE.requestPermission().then(function(state){
          if (state === 'granted') attachGyro(); else attachScroll();
        }).catch(function(){ attachScroll(); });
        if (chip){ chip.remove(); chip = null; }
      });
    } else if (DOE && 'ondeviceorientation' in window){
      attachGyro();        // Android / non-gated browsers
    } else {
      attachScroll();      // no gyroscope available
    }

    venueTilt = {
      dispose: function(){
        running = false;
        if (raf) cancelAnimationFrame(raf);
        if (orientHandler) window.removeEventListener('deviceorientation', orientHandler, true);
        if (scrollHandler) scroller.removeEventListener('scroll', scrollHandler);
        if (chip){ chip.remove(); chip = null; }
        scroller.classList.remove('venue-tilt-live');
        for (let i = 0; i < photos.length; i++) photos[i].style.transform = '';
      }
    };
  }

  // Bind interactive widgets per spread
  function bindSpreadInteractions(spreadIdx){
    stopPhotoCarousel();
    stopVenueTilt();
    if (spreadIdx === 8){
      updateDaysToGo();
      renderAttendees();
    }
    if (spreadIdx === 9){
      bindFaq();
    }
    if (spreadIdx === 10){
      bindRsvpForm();
      applyInviteTypeMessage();
    }
  }

  // ====== FAQ accordion ======
  // Native <details> handles toggle; we just make sibling items close so
  // only one answer is open at a time within a page.
  function bindFaq(){
    const items = document.querySelectorAll('#basePageLeft .faq-item, #basePageRight .faq-item');
    items.forEach(d => {
      if (d.dataset.bound) return;
      d.dataset.bound = 'true';
      d.addEventListener('toggle', () => {
        if (!d.open) return;
        d.parentElement.querySelectorAll('.faq-item[open]').forEach(o => {
          if (o !== d) o.open = false;
        });
      });
    });
  }

  // ====== Attendees ======
  // Google Sheet is the only source of truth. No localStorage cache —
  // deletions in the Sheet must reflect on the site immediately.
  const SESSION_SUBMIT_KEY = 'elijah_rsvp_submitted';
  let attendeesCache = []; // in-memory only, populated by fetchAttendees
  function hasSubmittedThisSession(){
    try { return sessionStorage.getItem(SESSION_SUBMIT_KEY) === '1'; }
    catch(e){ return false; }
  }
  function markSubmittedThisSession(){
    try { sessionStorage.setItem(SESSION_SUBMIT_KEY, '1'); } catch(e){}
  }
  function normalizeName(s){
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function validGuestPayload(data){
    return data && data.ok && Array.isArray(data.guests);
  }
  function fetchAttendeesJsonp(){
    return new Promise((resolve, reject) => {
      const callback = 'elijahGuests_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const cleanup = () => {
        delete window[callback];
        script.remove();
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Guest list JSONP timed out'));
      }, 10000);

      window[callback] = (data) => {
        clearTimeout(timeout);
        cleanup();
        if (validGuestPayload(data)) resolve(data.guests);
        else reject(new Error('Guest list JSONP returned an invalid payload'));
      };
      script.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error('Guest list JSONP failed to load'));
      };
      script.src = RSVP_ENDPOINT + '?callback=' + encodeURIComponent(callback) + '&t=' + Date.now();
      document.head.appendChild(script);
    });
  }
  async function fetchAttendees(){
    if (!RSVP_ENDPOINT || RSVP_ENDPOINT.includes('PASTE_GAS_WEB_APP_URL_HERE')){
      return null;
    }
    let fetchError = null;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(RSVP_ENDPOINT + '?t=' + Date.now(), {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl.signal,
        redirect: 'follow'
      });
      clearTimeout(to);
      if (!res.ok) throw new Error('Guest list fetch returned HTTP ' + res.status);
      const data = await res.json();
      if (validGuestPayload(data)) return data.guests;
      throw new Error('Guest list fetch returned an invalid payload');
    } catch (e){
      fetchError = e;
    }

    try {
      return await fetchAttendeesJsonp();
    } catch (jsonpError){
      console.warn('Could not load Google Sheet guest list.', {
        fetchError: fetchError,
        jsonpError: jsonpError
      });
      return null;
    }
  }
  function initials(name){
    return name.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() || '').join('');
  }
  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[s]));
  }
  function paintAttendees(list){
    const yes = list.filter(a => a.attending && /^yes/i.test(a.attending));
    const container = document.getElementById('attendeesList');
    const emptyEl = document.getElementById('attendeesEmpty');
    const loaderEl = document.getElementById('attendeesLoader');
    if (!container) return;

    if (loaderEl) loaderEl.style.display = 'none';
    container.innerHTML = '';
    if (yes.length === 0){
      if (emptyEl) emptyEl.style.display = 'block';
      const sg = document.getElementById('statGuests'); if (sg) sg.textContent = '0';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    let totalGuests = 0;
    yes.forEach(a => {
      const adults = parseInt(a.adults, 10) || 1;
      const children = parseInt(a.children, 10) || 0;
      totalGuests += adults + children;

      const plusBits = [];
      if (adults > 1) plusBits.push(`+${adults - 1} adult${adults - 1 === 1 ? '' : 's'}`);
      if (children > 0) plusBits.push(`+${children} ${children === 1 ? 'child' : 'children'}`);
      const message = String(a.message || '').trim();

      const chip = document.createElement('div');
      chip.className = 'guest-chip';
      chip.innerHTML = `
        <div class="guest-avatar">${initials(a.name)}</div>
        <div class="guest-copy">
          <div class="name">${escapeHtml(a.name)}</div>
          ${plusBits.length ? `<div class="plus">${plusBits.join(' · ')}</div>` : ''}
          ${message ? `<div class="guest-message">${escapeHtml(message)}</div>` : ''}
        </div>
      `;
      container.appendChild(chip);
    });
    const sg = document.getElementById('statGuests'); if (sg) sg.textContent = totalGuests;
  }
  async function renderAttendees(){
    const loaderEl = document.getElementById('attendeesLoader');
    const emptyEl = document.getElementById('attendeesEmpty');
    if (loaderEl) loaderEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    const fresh = await fetchAttendees();
    if (fresh){
      attendeesCache = fresh;
      paintAttendees(fresh);
    } else {
      paintAttendees(attendeesCache);
    }
  }

  // Days to go
  function updateDaysToGo(){
    const partyDate = new Date('2026-07-26T12:00:00+02:00');
    const today = new Date();
    const daysToGo = Math.max(0, Math.ceil((partyDate - today) / (1000 * 60 * 60 * 24)));
    const el = document.getElementById('statDays');
    if (el) el.textContent = daysToGo > 0 ? daysToGo : '🎉';

    // Days-to-go badge on the RSVP shortcut button
    const badge = document.getElementById('rsvpDaysBadge');
    if (badge){
      if (daysToGo > 0){
        const word = daysToGo === 1 ? 'day' : 'days';
        badge.textContent = daysToGo + ' ' + word + ' to go';
        badge.setAttribute('title', daysToGo + ' ' + word + ' to go');
        badge.hidden = false;
      } else {
        badge.textContent = '🎉 Today!';
        badge.setAttribute('title', "It's the big day!");
        badge.hidden = false;
      }
    }
  }

  // ========================================================
  //  INVITE-TYPE — Different URL params let you send different versions
  //  to different guests using the same file.
  //
  //  URL examples:
  //    yoursite.com/           → default (1-2 adults, 0-4 children)
  //    yoursite.com/?solo      → 1 adult, no children (locked)
  //    yoursite.com/?couple    → 2 adults, no children (locked)
  //    yoursite.com/?family    → 2 adults, choose 1-4 children
  //  Also accepts ?invite=solo / ?invite=couple / ?invite=family
  // ========================================================
  function getInviteType(){
    // Path/hash code: /1 /2 /3 → solo / couple / family
    // Works with hash (#/1) and pathname (/1) so it survives static hosts.
    const pathCode = (window.location.pathname + window.location.hash)
      .match(/(?:^|\/|#\/?)([123])(?:[\/?#]|$)/);
    if (pathCode){
      if (pathCode[1] === '1') return 'solo';
      if (pathCode[1] === '2') return 'couple';
      if (pathCode[1] === '3') return 'family';
    }
    const qs = new URLSearchParams(window.location.search);
    if (qs.has('1') || qs.get('t') === '1') return 'solo';
    if (qs.has('2') || qs.get('t') === '2') return 'couple';
    if (qs.has('3') || qs.get('t') === '3') return 'family';
    if (qs.has('solo')) return 'solo';
    if (qs.has('couple')) return 'couple';
    if (qs.has('family')) return 'family';
    const inv = (qs.get('invite') || '').toLowerCase();
    if (['solo','couple','family'].includes(inv)) return inv;
    return 'default';
  }
  const INVITE_TYPE = getInviteType();

  // Strip the invite code from the address bar once captured so guests
  // don't see /1, /2, /3 (or ?1, #/1) after the page loads. The site is
  // single-page, so replaceState has no navigation side-effects.
  if (INVITE_TYPE !== 'default'){
    try {
      // Drop path code, query string AND hash — leave only the site root.
      const baseDir = window.location.pathname
        .replace(/\/(?:[123]|index\.html)\/?$/, '/')
        .replace(/\/[123]\/index\.html$/, '/');
      history.replaceState(null, '', baseDir || '/');
    } catch(e){}
  }

  // Apply invite-type locks to the RSVP form fields
  function applyInviteType(form){
    if (!form || INVITE_TYPE === 'default') return;
    const adults = form.querySelector('select[name="adults"]');
    const children = form.querySelector('select[name="children"]');
    const adultsGroup = adults ? adults.closest('.form-group') : null;
    const childrenGroup = children ? children.closest('.form-group') : null;

    if (INVITE_TYPE === 'solo'){
      if (adults){ adults.value = '1'; adults.disabled = true; }
      if (children){ children.value = '0'; children.disabled = true; }
      if (childrenGroup) childrenGroup.style.display = 'none';
      if (adultsGroup){
        const note = adultsGroup.querySelector('.invite-lock');
        if (!note){
          const span = document.createElement('span');
          span.className = 'invite-lock';
          span.textContent = 'Invited as a solo guest';
          adultsGroup.appendChild(span);
        }
      }
    } else if (INVITE_TYPE === 'couple'){
      if (adults){ adults.value = '2'; adults.disabled = true; }
      if (children){ children.value = '0'; children.disabled = true; }
      if (childrenGroup) childrenGroup.style.display = 'none';
      if (adultsGroup){
        const note = adultsGroup.querySelector('.invite-lock');
        if (!note){
          const span = document.createElement('span');
          span.className = 'invite-lock';
          span.textContent = 'Invited for two';
          adultsGroup.appendChild(span);
        }
      }
    } else if (INVITE_TYPE === 'family'){
      if (adults){ adults.value = '2'; adults.disabled = true; }
      if (children){ children.value = '1'; children.disabled = true; }
      if (adultsGroup){
        const note = adultsGroup.querySelector('.invite-lock');
        if (!note){
          const span = document.createElement('span');
          span.className = 'invite-lock';
          span.textContent = 'Invited as a family of three';
          adultsGroup.appendChild(span);
        }
      }
    }

    // Add a hidden field so you can see in the email which version was sent
    if (!form.querySelector('input[name="invite_type"]')){
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'invite_type';
      hidden.value = INVITE_TYPE;
      form.appendChild(hidden);
    }
  }

  // Customize the invitation copy on spread 8 left based on invite type
  function applyInviteTypeMessage(){
    if (INVITE_TYPE === 'default') return;
    const inviteCopy = {
      solo: 'You are warmly invited — please let us know if you can join us.',
      couple: 'You and your plus-one are warmly invited — please let us know if you can join us.',
      family: 'You, your partner & your little one are warmly invited — please let us know if you can join us.'
    };
    const note = inviteCopy[INVITE_TYPE];
    if (!note) return;
    // Find the rsvp-invite-text paragraphs in any currently-rendered spread-8-left
    document.querySelectorAll('.rsvp-invite-text').forEach(el => {
      if (el.dataset.inviteUpdated) return;
      el.dataset.inviteUpdated = 'true';
    });
    // Also override the first paragraph if it's currently visible
    const firstText = document.querySelector('.rsvp-invite .rsvp-invite-text:not([data-invite-override])');
    if (firstText){
      firstText.textContent = note;
      firstText.dataset.inviteOverride = 'true';
    }
  }

  // ====== Add-to-Calendar ======
  // Event: Elijah's 1st Birthday — 2026-07-26 12:30–16:30 Malta (CEST, UTC+2)
  const CAL_EVENT = {
    title: "Elijah Theodore Bandong's 1st Birthday Party",
    startUtc: '20260726T103000Z',
    endUtc:   '20260726T143000Z',
    location: 'State Hall & Alexandra Gardens, Sliema, Malta',
    details:  "Join us in celebrating Elijah's first birthday! Smart elegant attire kindly requested. More details: https://elijahturnsone.com"
  };
  function googleCalendarUrl(){
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: CAL_EVENT.title,
      dates: `${CAL_EVENT.startUtc}/${CAL_EVENT.endUtc}`,
      details: CAL_EVENT.details,
      location: CAL_EVENT.location
    });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }
  function buildIcs(){
    const esc = s => String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Elijah Turns One//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:elijah-1st-birthday-2026-07-26@elijahturnsone.com',
      'DTSTAMP:20260101T000000Z',
      `DTSTART:${CAL_EVENT.startUtc}`,
      `DTEND:${CAL_EVENT.endUtc}`,
      `SUMMARY:${esc(CAL_EVENT.title)}`,
      `LOCATION:${esc(CAL_EVENT.location)}`,
      `DESCRIPTION:${esc(CAL_EVENT.details)}`,
      'END:VEVENT',
      'END:VCALENDAR',
      ''
    ].join('\r\n');
  }
  function icsBlobUrl(){
    const blob = new Blob([buildIcs()], { type: 'text/calendar;charset=utf-8' });
    return URL.createObjectURL(blob);
  }
  function renderCalendarInvite(target){
    if (!target) return;
    if (target.querySelector('.cal-invite')) return;
    const wrap = document.createElement('div');
    wrap.className = 'cal-invite';
    wrap.innerHTML = `
      <div class="cal-invite-head">
        <span class="cal-eyebrow">— Save the Date —</span>
        <div class="cal-invite-meta">
          <strong>Saturday, 26 July 2026</strong>
          <span>12:30 – 16:30 · Sliema, Malta</span>
        </div>
      </div>
      <div class="cal-invite-actions">
        <a class="cal-btn cal-btn-google" target="_blank" rel="noopener" href="${googleCalendarUrl()}">Google Calendar</a>
        <a class="cal-btn cal-btn-ics" download="elijah-1st-birthday.ics" href="#">Apple · Outlook (.ics)</a>
      </div>
    `;
    const icsLink = wrap.querySelector('.cal-btn-ics');
    icsLink.addEventListener('click', (e) => {
      e.preventDefault();
      const url = icsBlobUrl();
      const a = document.createElement('a');
      a.href = url;
      a.download = 'elijah-1st-birthday.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
    target.appendChild(wrap);
  }

  // ====== RSVP Form ======
  function bindRsvpForm(){
    const form = document.getElementById('rsvpForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = 'true';

    // Apply any URL-based invite-type locks (solo/couple/family)
    applyInviteType(form);

    // If this browser already submitted in this session, lock the form immediately.
    if (hasSubmittedThisSession()){
      const submitBtn = document.getElementById('submitBtn');
      const statusEl = document.getElementById('formStatus');
      if (submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Already sent ✓'; }
      if (statusEl){
        statusEl.className = 'form-status success';
        statusEl.textContent = '🧸 You\'ve already RSVP\'d in this session. Refresh tomorrow to update.';
        renderCalendarInvite(statusEl);
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('formStatus');
      const submitBtn = document.getElementById('submitBtn');

      // Session guard — one submit per browser session.
      if (hasSubmittedThisSession()){
        statusEl.className = 'form-status success';
        statusEl.textContent = '🧸 You\'ve already RSVP\'d. Save the date below.';
        renderCalendarInvite(statusEl);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Already sent ✓';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      statusEl.className = 'form-status';
      statusEl.textContent = '';

      try {
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        // Include values from disabled (locked) selects/inputs — FormData skips them
        form.querySelectorAll('select:disabled, input:disabled').forEach(el => {
          if (el.name && !(el.name in payload)){
            payload[el.name] = el.value;
            formData.append(el.name, el.value);
          }
        });

        // Duplicate-name check against the live Sheet (source of truth).
        const submittedName = normalizeName(payload.name);
        if (!submittedName){
          statusEl.className = 'form-status error';
          statusEl.textContent = 'Please enter your name.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send RSVP';
          return;
        }
        const liveList = await fetchAttendees();
        if (Array.isArray(liveList)){
          attendeesCache = liveList;
          const dup = liveList.some(g => normalizeName(g.name) === submittedName);
          if (dup){
            statusEl.className = 'form-status error';
            statusEl.textContent = 'An RSVP already exists for that name. WhatsApp +356 99488202 to update it.';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send RSVP';
            return;
          }
        }

        if (!RSVP_ENDPOINT || RSVP_ENDPOINT.includes('PASTE_GAS_WEB_APP_URL_HERE')){
          statusEl.className = 'form-status error';
          statusEl.textContent = 'RSVP endpoint not configured. Please WhatsApp +356 99488202.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send RSVP';
          return;
        }

        // Send as multipart form-data — Apps Script reads via e.parameter
        // and this avoids a CORS preflight on the Web App URL.
        await fetch(RSVP_ENDPOINT, {
          method: 'POST',
          mode: 'no-cors',
          body: formData
        });

        markSubmittedThisSession();

        // Re-fetch from the Sheet so the painted list reflects the truth,
        // not an optimistic local guess.
        renderAttendees();

        statusEl.className = 'form-status success';
        statusEl.textContent = '🧸 Thank you! Your RSVP has been received.';
        renderCalendarInvite(statusEl);
        form.reset();
        submitBtn.textContent = 'Sent ✓';
      } catch (err){
        statusEl.className = 'form-status error';
        statusEl.textContent = 'Something went wrong. Please WhatsApp +356 99488202';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send RSVP';
      }
    });
  }

  // ========================================================
  //  SOUND EFFECTS — synthesized via Web Audio API
  //  No external files. Mute toggle persisted to localStorage.
  // ========================================================
  let audioCtx = null;
  let soundsEnabled = true;
  try {
    soundsEnabled = localStorage.getItem('elijah_sounds') !== 'off';
  } catch(e){}

  function getAudio(){
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e){ return null; }
    return audioCtx;
  }
  // Resume audio after first user gesture (browser autoplay policy)
  function unlockAudio(){
    const ctx = getAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  document.addEventListener('click', unlockAudio, { once: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { once: true, passive: true });
  document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });

  // Paper flip sound — band-limited noise burst with quick decay,
  // shaped to sound like a single page turning.
  function playPaperFlip(){
    if (!soundsEnabled) return;
    const ctx = getAudio();
    if (!ctx) return;
    try {
      const duration = 0.55;
      const bufferSize = ctx.sampleRate * duration;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      // Generate shaped noise — a quick fade-in, sustain, then fade-out
      for (let i = 0; i < bufferSize; i++){
        const t = i / bufferSize;
        // Envelope: short attack, mid sustain peaking near 30%, then decay
        let env;
        if (t < 0.1) env = t / 0.1;                  // attack
        else if (t < 0.35) env = 1 - (t - 0.1) * 0.3; // small decay
        else env = (1 - 0.075) * Math.pow(1 - (t - 0.35) / 0.65, 1.6); // long fade
        data[i] = (Math.random() * 2 - 1) * env * 0.5;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      // Band-pass filter for "paper" tone — emphasize ~2-4kHz
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 2800;
      bandpass.Q.value = 0.8;

      // Slight high-shelf cut to soften
      const highshelf = ctx.createBiquadFilter();
      highshelf.type = 'highshelf';
      highshelf.frequency.value = 6000;
      highshelf.gain.value = -6;

      // Gain envelope to taper the overall sound
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      noise.connect(bandpass).connect(highshelf).connect(gain).connect(ctx.destination);
      noise.start();
      noise.stop(ctx.currentTime + duration);
    } catch(e){ /* silent fail */ }
  }

  // Soft chime — for opening the book
  function playChime(){
    if (!soundsEnabled) return;
    const ctx = getAudio();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Two-note chime: C5 + E5 (warm)
      [
        { freq: 523.25, delay: 0,    duration: 1.2 },
        { freq: 659.25, delay: 0.08, duration: 1.0 }
      ].forEach(({freq, delay, duration}) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.05, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + duration);
      });
    } catch(e){}
  }

  // Light tick — for UI feedback (button click)
  function playTick(){
    if (!soundsEnabled) return;
    const ctx = getAudio();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.02, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch(e){}
  }


  // ========================================================
  //  BACKGROUND MUSIC — local HTMLAudio element
  //  Browsers block autoplay with sound, so we attempt play() on load
  //  (likely fails) and again on first user gesture (succeeds).
  // ========================================================

  const bgMusic = document.getElementById('bgMusic');
  if (bgMusic) bgMusic.volume = 0.22;

  function startMusic(){
    if (!bgMusic) return;
    try { bgMusic.play().catch(()=>{}); } catch(e){}
  }
  function stopMusic(){
    if (!bgMusic) return;
    try { bgMusic.pause(); } catch(e){}
  }

  // Attempt early autoplay (may fail until user interacts)
  startMusic();

  // Watchdog: if music should be playing but isn't, try again.
  setInterval(() => {
    if (!bgMusic || !soundsEnabled) return;
    if (bgMusic.paused) startMusic();
  }, 4000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && soundsEnabled) startMusic();
  });

  function toggleSounds(){
    soundsEnabled = !soundsEnabled;
    try { localStorage.setItem('elijah_sounds', soundsEnabled ? 'on' : 'off'); } catch(e){}
    if (soundsEnabled){
      playTick();
      startMusic();
    } else {
      stopMusic();
    }
    return soundsEnabled;
  }

  // Start audio on the first user gesture of any kind
  let musicAutoStartFired = false;
  function fireAutoStart(){
    if (musicAutoStartFired) return;
    musicAutoStartFired = true;
    document.removeEventListener('pointerdown', fireAutoStart);
    document.removeEventListener('keydown', fireAutoStart);
    document.removeEventListener('touchstart', fireAutoStart);
    document.removeEventListener('scroll', fireAutoStart);
    window.removeEventListener('focus', fireAutoStart);
    if (soundsEnabled) startMusic();
  }
  document.addEventListener('pointerdown', fireAutoStart, { passive: true });
  document.addEventListener('keydown', fireAutoStart, { passive: true });
  document.addEventListener('touchstart', fireAutoStart, { passive: true });
  document.addEventListener('scroll', fireAutoStart, { passive: true });
  window.addEventListener('focus', fireAutoStart);


  // ========================================================
  //  THE FLIP ENGINE
  //  Architecture: rather than maintain a complex stack of leaves,
  //  we use a SINGLE flip leaf overlay that animates the page turn,
  //  while the base pages instantly reflect the new spread underneath.
  // ========================================================

  // Mobile page-sweep overlay: a cream sheet that travels across the screen.
  // Forward (next page) — sweeps right→left, like a new page coming over from the right.
  // Backward (prev page) — sweeps left→right, like a page coming back.
  const pageSweepEl = document.getElementById('pageSweep');
  function triggerPageSweep(direction){
    if (!pageSweepEl) return;
    // Reset any previous animation
    pageSweepEl.classList.remove('active', 'sweep-forward', 'sweep-backward');
    // Force reflow so the next class addition restarts the animation
    void pageSweepEl.offsetWidth;
    pageSweepEl.classList.add('active', direction === 'backward' ? 'sweep-backward' : 'sweep-forward');
    // Clean up after the animation finishes (900ms + tiny buffer)
    setTimeout(() => {
      pageSweepEl.classList.remove('active', 'sweep-forward', 'sweep-backward');
    }, 950);
  }

  function createFlipLeaf(direction, fromSpread, toSpread){
    const leaf = document.createElement('div');
    leaf.className = 'leaf' + (direction === 'backward' ? ' backward' : '');
    leaf.style.zIndex = '200';

    const front = document.createElement('div');
    front.className = 'face front';
    const back = document.createElement('div');
    back.className = 'face back';

    if (isMobile()){
      // On mobile, each face shows the entire spread (left+divider+right) stacked
      front.appendChild(buildMobileSpread(fromSpread));
      back.appendChild(buildMobileSpread(toSpread));
    } else if (direction === 'forward'){
      const rightContent = tpl(`tpl-spread-${fromSpread}-right`);
      const nextLeftContent = tpl(`tpl-spread-${toSpread}-left`);
      if (rightContent) front.appendChild(rightContent);
      if (nextLeftContent) back.appendChild(nextLeftContent);
    } else {
      const leftContent = tpl(`tpl-spread-${fromSpread}-left`);
      const prevRightContent = tpl(`tpl-spread-${toSpread}-right`);
      if (leftContent) front.appendChild(leftContent);
      if (prevRightContent) back.appendChild(prevRightContent);
    }

    leaf.appendChild(front);
    leaf.appendChild(back);
    return leaf;
  }

  function goTo(targetSpread){
    if (isFlipping) return;
    targetSpread = Math.max(0, Math.min(TOTAL_SPREADS - 1, targetSpread));
    if (targetSpread === currentSpread) return;

    isFlipping = true;
    const direction = targetSpread > currentSpread ? 'forward' : 'backward';

    // Mobile TOC sub-page: arriving forward (from cover) shows the contents
    // list; arriving backward (from a later chapter) shows the photo, since the
    // photo sits "after" the list in reading order. Any other spread clears it.
    if (targetSpread === 1) tocMobilePhoto = (currentSpread > 1);
    else tocMobilePhoto = false;

    // Update controls preemptively
    updateNav(targetSpread);

    // Special case: cover transitions
    if (currentSpread === 0 && targetSpread === 1){
      const mobile = isMobile();
      applyCoverLayout(1);
      playChime();
      setTimeout(playPaperFlip, 100);

      if (mobile){
        // Populate the base page NOW so it's ready underneath when the cover slides off
        basePageRight.innerHTML = '';
        basePageRight.appendChild(buildMobileSpread(1));
        basePageRight.classList.add('toc-split');
        basePageRight.scrollTop = 0;
        bindTocLinks();
        // Trigger cover slide
        requestAnimationFrame(() => {
          requestAnimationFrame(() => coverLeaf.classList.add('flipped'));
        });
        setTimeout(() => {
          coverLeaf.style.display = 'none';
          currentSpread = 1;
          isFlipping = false;
          updateNav(currentSpread);
          bindSpreadInteractions(currentSpread);
        }, 700);
        return;
      }

      // DESKTOP: cover-back face shows TOC during rotation; populate base right NOW
      // so the image has time to decode/paint before the cover rotates past 90°.
      setCoverBack();
      basePageRight.innerHTML = '';
      const newRightEarly = tpl('tpl-spread-1-right');
      if (newRightEarly) basePageRight.appendChild(newRightEarly);

      let finished = false;
      const onDone = () => {
        if (finished) return;
        finished = true;
        coverLeaf.removeEventListener('transitionend', onTransition);
        basePageLeft.innerHTML = '';
        const newLeft = tpl('tpl-spread-1-left');
        if (newLeft) basePageLeft.appendChild(newLeft);
        bindTocLinks();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            coverLeaf.style.display = 'none';
            currentSpread = 1;
            isFlipping = false;
            updateNav(currentSpread);
            bindSpreadInteractions(currentSpread);
          });
        });
      };
      const onTransition = (e) => {
        if (e.target === coverLeaf && e.propertyName === 'transform') onDone();
      };
      coverLeaf.addEventListener('transitionend', onTransition);
      setTimeout(onDone, 1400);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => coverLeaf.classList.add('flipped'));
      });
      return;
    }

    if (currentSpread === 1 && targetSpread === 0){
      const mobile = isMobile();
      playPaperFlip();

      if (mobile){
        // Cover slides back from off-screen-left to its original position covering the page
        coverLeaf.style.display = '';
        coverLeaf.classList.add('flipped'); // at translateX(-110%) — off to the left
        void coverLeaf.offsetWidth;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => coverLeaf.classList.remove('flipped')); // slides back to translateX(0)
        });
        setTimeout(() => {
          basePageRight.innerHTML = '';
          basePageLeft.innerHTML = '';
          currentSpread = 0;
          isFlipping = false;
          updateNav(currentSpread);
          applyCoverLayout(0);
        }, 700);
        return;
      }

      // DESKTOP: rotate cover-leaf back to 0
      coverLeaf.style.display = '';
      coverLeaf.classList.add('flipped');
      void coverLeaf.offsetWidth;
      basePageLeft.innerHTML = '';

      let finished = false;
      const onDone = () => {
        if (finished) return;
        finished = true;
        coverLeaf.removeEventListener('transitionend', onTransition);
        basePageRight.innerHTML = '';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            currentSpread = 0;
            isFlipping = false;
            updateNav(currentSpread);
            applyCoverLayout(0);
          });
        });
      };
      const onTransition = (e) => {
        if (e.target === coverLeaf && e.propertyName === 'transform') onDone();
      };
      coverLeaf.addEventListener('transitionend', onTransition);
      setTimeout(onDone, 1400);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => coverLeaf.classList.remove('flipped'));
      });
      return;
    }

    // Jumps that skip past the cover from cover
    if (currentSpread === 0 && targetSpread > 1){
      const mobile = isMobile();

      if (mobile){
        // Mobile: slide the cover off, then slide in the target content directly
        applyCoverLayout(1);
        playPaperFlip();
        basePageRight.innerHTML = '';
        basePageRight.appendChild(buildMobileSpread(targetSpread));
        basePageRight.classList.toggle('toc-split', targetSpread === 1);
        basePageRight.scrollTop = 0;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => coverLeaf.classList.add('flipped'));
        });
        setTimeout(() => {
          coverLeaf.style.display = 'none';
          currentSpread = targetSpread;
          isFlipping = false;
          updateNav(currentSpread);
          bindSpreadInteractions(currentSpread);
        }, 700);
        return;
      }

      // DESKTOP: open the cover with animation, then chain to target
      applyCoverLayout(1);
      setCoverBack();
      setBasePages(1);
      playPaperFlip();
      const onDone = () => {
        coverLeaf.removeEventListener('transitionend', onTransition);
        coverLeaf.style.display = 'none';
        currentSpread = 1;
        isFlipping = false;
        goTo(targetSpread);
      };
      const onTransition = (e) => { if (e.target === coverLeaf && e.propertyName === 'transform') onDone(); };
      coverLeaf.addEventListener('transitionend', onTransition);
      setTimeout(onDone, 1300);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => coverLeaf.classList.add('flipped'));
      });
      return;
    }

    if (currentSpread > 1 && targetSpread === 0){
      const mobile = isMobile();

      if (mobile){
        // Mobile: clear content, slide cover back into view
        playPaperFlip();
        coverLeaf.style.display = '';
        coverLeaf.classList.add('flipped');
        void coverLeaf.offsetWidth;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => coverLeaf.classList.remove('flipped'));
        });
        setTimeout(() => {
          basePageRight.innerHTML = '';
          basePageLeft.innerHTML = '';
          currentSpread = 0;
          isFlipping = false;
          updateNav(currentSpread);
          applyCoverLayout(0);
        }, 700);
        return;
      }

      // DESKTOP: snap to spread 1, then animate cover-leaf back to 0
      setBasePages(1);
      coverLeaf.style.display = '';
      coverLeaf.classList.add('flipped');
      void coverLeaf.offsetWidth;
      currentSpread = 1;
      setBasePages(0);
      playPaperFlip();
      const onDone = () => {
        coverLeaf.removeEventListener('transitionend', onTransition);
        currentSpread = 0;
        isFlipping = false;
        updateNav(currentSpread);
        applyCoverLayout(0);
      };
      const onTransition = (e) => { if (e.target === coverLeaf && e.propertyName === 'transform') onDone(); };
      coverLeaf.addEventListener('transitionend', onTransition);
      setTimeout(onDone, 1300);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => coverLeaf.classList.remove('flipped'));
      });
      return;
    }

    // Multi-page jumps (between content spreads) — use a clean sweep, not a flip
    if (Math.abs(targetSpread - currentSpread) > 1){
      triggerPageSweep(direction);
      playPaperFlip();
      // Swap base pages while the sweep is fully covering (mid-animation)
      setTimeout(() => {
        setBasePages(targetSpread);
        currentSpread = targetSpread;
        bindSpreadInteractions(targetSpread);
      }, 380);
      setTimeout(() => {
        isFlipping = false;
        updateNav(targetSpread);
      }, 760);
      return;
    }

    // Standard adjacent-spread flip
    animateFlip(currentSpread, targetSpread, direction, () => {
      currentSpread = targetSpread;
      isFlipping = false;
      updateNav(currentSpread);
    });
  }

  // Mobile: swap the TOC between its contents-list and photo sub-pages with a
  // page sweep — no spread change, just re-render the single visible section.
  function showTocMobilePage(showPhoto){
    if (isFlipping) return;
    isFlipping = true;
    tocMobilePhoto = showPhoto;
    triggerPageSweep(showPhoto ? 'forward' : 'backward');
    playPaperFlip();
    setTimeout(() => {
      basePageRight.innerHTML = '';
      basePageRight.appendChild(buildMobileSpread(1));
      basePageRight.classList.add('toc-split');
      basePageRight.scrollTop = 0;
      bindTocLinks();
    }, 380);
    setTimeout(() => { isFlipping = false; }, 760);
  }

  // Next/Prev that honor the mobile TOC sub-page split. On mobile, stepping
  // forward off the contents list reveals the photo first; stepping back from
  // the photo returns to the list. Everywhere else, plain spread navigation.
  function stepNext(){
    if (isMobile() && currentSpread === 1 && !tocMobilePhoto){ showTocMobilePage(true); return; }
    goTo(currentSpread + 1);
  }
  function stepPrev(){
    if (isMobile() && currentSpread === 1 && tocMobilePhoto){ showTocMobilePage(false); return; }
    goTo(currentSpread - 1);
  }

  function animateFlip(fromSpread, toSpread, direction, done){
    const mobile = isMobile();

    // ============================================================
    // MOBILE 3D PAGE-FLIP
    // The leaf shows the OLD spread on its front face (covering the page).
    // The base page underneath is updated to NEW spread immediately (hidden by the leaf).
    // The leaf rotates 180deg pivoting on its left edge (forward) or right edge (backward),
    // sweeping out of view to reveal the new content underneath.
    // ============================================================
    if (mobile){
      // Build a single-face leaf showing the OLD mobile spread
      const leaf = document.createElement('div');
      leaf.className = 'leaf' + (direction === 'backward' ? ' backward' : '');
      leaf.style.zIndex = '200';
      const front = document.createElement('div');
      front.className = 'face front';
      front.appendChild(buildMobileSpread(fromSpread));
      const back = document.createElement('div');
      back.className = 'face back';
      // back is what's visible after 180deg — but we want the leaf to sweep AWAY,
      // not show its back. Hide the back so we only see emptiness on the other side.
      back.style.background = 'transparent';
      leaf.appendChild(front);
      leaf.appendChild(back);

      const targetZone = document.querySelector('.leaves .right-zone');
      targetZone.appendChild(leaf);

      // Pre-populate basePageRight with NEW content — hidden under the leaf
      basePageRight.innerHTML = '';
      basePageRight.appendChild(buildMobileSpread(toSpread));
      basePageRight.classList.toggle('toc-split', toSpread === 1);
      basePageRight.scrollTop = 0;

      void leaf.offsetHeight;
      playPaperFlip();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => leaf.classList.add('flipped'));
      });

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        leaf.remove();
        bindSpreadInteractions(toSpread);
        done();
      };
      leaf.addEventListener('transitionend', (e) => {
        if (e.target === leaf && e.propertyName === 'transform') finish();
      });
      setTimeout(finish, 1000);
      return;
    }

    // ============================================================
    // DESKTOP PATH: 3D leaf rotation around the spine (unchanged)
    // ============================================================

    const leaf = createFlipLeaf(direction, fromSpread, toSpread);
    const targetZone = direction === 'forward'
      ? document.querySelector('.leaves .right-zone')
      : document.querySelector('.leaves .left-zone');
    targetZone.appendChild(leaf);
    void leaf.offsetHeight;

    // Asymmetric swap kills the 90° flash. The leaf-front covers ONE zone for the
    // first half of the rotation; pre-populate that base now (hidden under the leaf).
    // The OTHER base stays OLD and swaps mid-rotation while the leaf-back covers it.
    //   forward : leaf-front covers right-zone → pre-populate base-RIGHT with NEW
    //             base-LEFT swaps later (covered by leaf-back past 90°)
    //   backward: leaf-front covers left-zone  → pre-populate base-LEFT with NEW
    //             base-RIGHT swaps later
    const preBase    = direction === 'forward' ? basePageRight : basePageLeft;
    const lateBase   = direction === 'forward' ? basePageLeft  : basePageRight;
    const preSide    = direction === 'forward' ? 'right' : 'left';
    const lateSide   = direction === 'forward' ? 'left'  : 'right';
    preBase.innerHTML = '';
    const preContent = tpl(`tpl-spread-${toSpread}-${preSide}`);
    if (preContent) preBase.appendChild(preContent);

    let swapped = false;
    const swapBase = () => {
      if (swapped) return;
      swapped = true;
      lateBase.innerHTML = '';
      const lateContent = tpl(`tpl-spread-${toSpread}-${lateSide}`);
      if (lateContent) lateBase.appendChild(lateContent);
    };
    // ~70% time = leaf-back has fully covered the destination zone (cubic-bezier
    // (.32,.04,.32,1) puts rotation past ~150° by then, so the swap is hidden).
    const swapTimer = setTimeout(swapBase, FLIP_DURATION * 0.7);

    playPaperFlip();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => leaf.classList.add('flipped'));
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(swapTimer);
      swapBase();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          leaf.remove();
          bindSpreadInteractions(toSpread);
          done();
        });
      });
    };
    leaf.addEventListener('transitionend', (e) => {
      if (e.target === leaf && e.propertyName === 'transform') finish();
    });
    setTimeout(finish, FLIP_DURATION + 200);
  }

  function updateNav(spreadIdx){
    spreadIndicator.textContent = SPREAD_NAMES[spreadIdx] || `Page ${spreadIdx + 1}`;
    navPrev.disabled = (spreadIdx === 0);
    navNext.disabled = (spreadIdx === TOTAL_SPREADS - 1);
    updateChapterIndex(spreadIdx);
  }

  // Chapter index — desktop-only persistent strip shown once past TOC (spread > 1).
  const CHAPTER_ENTRIES = [
    { idx: 2,  label: 'Once',     num: 'I' },
    { idx: 3,  label: 'About',    num: 'II' },
    { idx: 4,  label: 'Memories', num: 'III' },
    { idx: 5,  label: 'Details',  num: 'IV' },
    { idx: 6,  label: 'Story',    num: 'V' },
    { idx: 7,  label: 'Finding',  num: 'VI' },
    { idx: 8,  label: 'Guests',   num: 'VII' },
    { idx: 9,  label: 'FAQ',      num: 'VIII' },
    { idx: 10, label: 'RSVP',     num: 'IX' },
    { idx: 11, label: 'End',      num: 'X' }
  ];
  function buildChapterIndex(){
    if (!chapterIndex || chapterIndex.dataset.built) return;
    chapterIndex.dataset.built = '1';
    CHAPTER_ENTRIES.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.target = c.idx;
      b.innerHTML = `<span class="ci-num">${c.num}</span>${c.label}`;
      b.addEventListener('click', () => goTo(c.idx));
      chapterIndex.appendChild(b);
    });
  }
  function updateChapterIndex(spreadIdx){
    if (!chapterIndex) return;
    const shouldShow = !isMobile() && spreadIdx > 1;
    if (shouldShow){
      buildChapterIndex();
      chapterIndex.hidden = false;
      requestAnimationFrame(() => chapterIndex.classList.add('visible'));
    } else {
      chapterIndex.classList.remove('visible');
      if (isMobile()) chapterIndex.hidden = true;
    }
    chapterIndex.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.target, 10) === spreadIdx);
    });
  }
  // Apply / remove the closed-book layout class — call this AFTER the flip animation
  function applyCoverLayout(spreadIdx){
    book.classList.toggle('at-cover', spreadIdx === 0);
  }

  // ====== Event wiring ======
  navPrev.addEventListener('click', () => stepPrev());
  navNext.addEventListener('click', () => stepNext());
  edgeLeft.addEventListener('click', () => stepPrev());
  edgeRight.addEventListener('click', () => stepNext());

  // Cover click opens the book
  coverFront.addEventListener('click', () => {
    if (currentSpread === 0) goTo(1);
  });

  // Brand → cover
  document.getElementById('brandHome').addEventListener('click', () => goTo(0));

  // RSVP shortcut
  document.getElementById('rsvpShortcut').addEventListener('click', () => goTo(10));

  // Sound toggle
  const soundToggle = document.getElementById('soundToggle');
  const sndOnIcon = soundToggle.querySelector('.snd-on');
  const sndOffIcon = soundToggle.querySelector('.snd-off');
  function syncSoundIcon(){
    sndOnIcon.style.display = soundsEnabled ? '' : 'none';
    sndOffIcon.style.display = soundsEnabled ? 'none' : '';
    soundToggle.setAttribute('aria-label', soundsEnabled ? 'Mute sounds' : 'Unmute sounds');
    soundToggle.setAttribute('title', soundsEnabled ? 'Mute sounds' : 'Unmute sounds');
  }
  syncSoundIcon();
  soundToggle.addEventListener('click', () => {
    toggleSounds();
    syncSoundIcon();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'ArrowRight'){ e.preventDefault(); stepNext(); }
    else if (e.key === 'ArrowLeft'){ e.preventDefault(); stepPrev(); }
    else if (e.key === 'Home'){ e.preventDefault(); goTo(0); }
    else if (e.key === 'End'){ e.preventDefault(); goTo(TOTAL_SPREADS - 1); }
  });

  // Touch swipe
  let touchStartX = 0, touchStartY = 0;
  book.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });
  book.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].screenX - touchStartX;
    const dy = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)){
      if (dx < 0) stepNext();
      else stepPrev();
    }
  }, { passive: true });

  // Menu open/close
  // ====== Initialize ======
  buildCoverFront();
  book.classList.add('at-cover');  // start in closed-book state
  updateNav(currentSpread);
  updateDaysToGo();

  // Prevent default page scroll (book is fixed) — but allow scroll inside scrollable areas
  const SCROLL_OK = '.attendees-list-wrap, .rsvp-form-page, .base-page.right, .leaf .face';
  document.addEventListener('wheel', (e) => {
    if (isMobile() && e.target.closest('.base-page.right, .leaf .face')) return;
    if (e.target.closest('.attendees-list-wrap, .rsvp-form-page')) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (isMobile() && e.target.closest('.base-page.right, .leaf .face')) return;
    if (e.target.closest('.attendees-list-wrap, .rsvp-form-page')) return;
    e.preventDefault();
  }, { passive: false });

  // On resize, rebuild current spread for new layout.
  // Only rebuild when the WIDTH changes — iOS Safari fires `resize` when the
  // on-screen keyboard opens (height shrinks), which used to wipe the RSVP
  // form mid-input on mobile.
  let resizeRaf = null;
  let lastResizeWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastResizeWidth) return;
    lastResizeWidth = window.innerWidth;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (currentSpread > 0 && !isFlipping) setBasePages(currentSpread);
      updateChapterIndex(currentSpread);
    });
  });

})();
