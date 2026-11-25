/* Setup hub mock (RockyRoad-kqg). Static: agrees layout and content, not focus or keyboard behaviour. */
(function () {
  var P = '../../../../public/';
  var S = { retune: 'label', card: 'two', calib: 'yes', repoSub: 'show', labels: 'input-mic', tune: 'button', req: 'cut', zoom: '1' };

  function img(n, cls) { return '<img class="' + (cls || 'sh-ic') + '" src="' + P + n + '.svg" alt="">'; }
  function mk(kind) {
    var c = kind === 'todo' ? '#8b8b8b' : '#fff';
    return '<svg class="sh-mk" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="' + c + '" stroke-width="1.5"/>' +
      (kind === 'done' ? '<path d="M4.8 8.3l2.2 2.2 4.2-4.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' : '') + '</svg>';
  }
  function btn(cls, icon, label, extra) {
    return '<button class="button ' + cls + ' icon-btn' + (label ? '' : ' sh-sq') + '" type="button" ' + (extra || '') + '>' +
      img(icon) + (label ? '<span>' + label + '</span>' : '') + '</button>';
  }

  // Wording switch: [Input label, card label]
  function words() {
    return { 'input-mic': ['Input', 'Mic'], 'input-device': ['Input', 'Device'], 'input-none': ['Input', ''], 'source-mic': ['Source', 'Mic'] }[S.labels];
  }

  var MIC_TEXT = {
    prompt: ['Mic permission needed', 'The prompt shows in the 2D browser.'],
    siteBlocked: ['Mic blocked for this site', 'Exit VR for the fix steps.', 'They are in the Browser app, not Settings.'],
    appBlocked: ['Mic is off for Browser', 'Exit VR, then tap Go to Settings.']
  };
  var MIDI_TEXT = {
    prompt: ['MIDI permission needed', 'The prompt shows in the 2D browser.'],
    blocked: ['MIDI blocked for this site', 'Exit VR for the fix steps.', 'They are in the Browser app, not Settings.']
  };

  function dd(label, menuItems, selected, w) {
    var m = menuItems ? '<div class="sh-menu"' + (w ? ' style="width:' + w + 'px"' : '') + '>' + menuItems.map(function (x) {
      return '<div class="' + (x === selected ? 'sel' : '') + '">' + x + '</div>';
    }).join('') + '</div>' : '';
    return '<div class="sh-dd"><div class="sh-trig"' + (w ? ' style="width:' + w + 'px"' : '') + '><span>' + label + '</span>' + img('chevron-down') + '</div>' + m + '</div>';
  }

  function inputRow(o) {
    var items = o.part === 'keys' ? ['None', 'Mic', 'MIDI'] : ['None', 'Mic'];
    var cur = { none: 'None', mic: 'Mic', midi: 'MIDI' }[o.input];
    return '<div class="sh-in-row"><span class="sh-lbl">' + words()[0] + '</span>' +
      dd(cur, o.menu === 'input' ? items : null, cur) + '</div>';
  }

  function micCard(o) {
    var w = words()[1];
    var dev = o.state === 'headset' ? 'Headset mic' : 'USB Audio Device';
    var lbl = w ? '<span class="sh-lbl">' + w + '</span>' : '';
    var devs = ['Headset mic', 'USB Audio Device'];
    var d = dd(dev, o.menu === 'device' ? devs : null, dev, 120);
    var meter = '<div class="sh-meter"><i></i></div>';
    var gain = function (wide) {
      return '<div class="sh-gain"><span class="sh-lbl">Gain</span><div class="sh-slider' + (wide ? ' wide' : '') + '"><div class="tr"><div class="fi"></div></div><div class="th"></div></div><span class="sh-gv">6x</span></div>';
    };
    if (o.state === 'headset') {
      var pick = w || 'the list';
      return '<div class="sh-card sh-cardmic"><div class="sh-microw">' + lbl + d + meter + '</div>' +
        '<div class="sh-sep"></div><div class="sh-warnin"><span class="t">Headset mic can\u2019t hear instruments</span>' +
        '<span class="l row">Plug in a USB mic, then pick it in ' + pick + '.' + INFO + '</span>' +
        '</div></div>';
    }
    var rows = S.card === 'one'
      ? '<div class="sh-microw">' + lbl + d + meter + gain(false) + '</div>'
      : '<div class="sh-microw">' + lbl + d + meter + '</div><div class="sh-microw">' + gain(true) + '</div>';
    var tune = '';
    if (o.part === 'guitar') {
      var tb = '<button class="button primary-dark sh-tune" type="button">' + img('tune-icon') + '<span>Tune</span></button>';
      tune = S.tune === 'button'
        ? '<div class="sh-microw sh-center">' + tb + '</div>'
        : '<div class="sh-sep"></div><div class="sh-step sh-trow"><span class="mk">' + (o.tuned ? mk('done') : mk('todo')) + '</span><span class="tx">' + (o.tuned ? 'Tuned' : 'Not tuned') + '</span><span class="sh-spacer"></span>' + tb + '</div>';
    }
    return '<div class="sh-card sh-cardmic">' + rows + tune + '</div>';
  }

  var INFO = '<svg class="sh-info" viewBox="0 0 16 16" aria-label="More info"><circle cx="8" cy="8" r="7" fill="none" stroke="#8b8b8b" stroke-width="1.4"/><circle cx="8" cy="4.9" r="1" fill="#c8c8c8"/><path d="M8 7.3v4.4" stroke="#c8c8c8" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function reqCard() {
    var subs = {
      full: ['Headset mic can\u2019t hear instruments', 'Plugs in to the USB-C port'],
      cut: ['Headset mic can\u2019t hear instruments'],
      info: []
    }[S.req];
    return '<div class="sh-card"><div class="sh-reqt">Needs both:</div>' +
      '<div class="sh-reqblock"><div class="sh-bul"><span class="dot"></span><b>External mic</b>' + (S.req === 'info' ? INFO : '') + '</div>' +
      subs.map(function (t) { return '<div class="sh-sub">' + t + '</div>'; }).join('') +
      '<div class="sh-bul"><span class="dot"></span><b>Bluetooth audio</b>' + (S.req === 'info' ? INFO : '') + '</div>' +
      (S.req === 'info' ? '' : '<div class="sh-sub">External mic mutes the speakers</div>') + '</div>' +
      '<div class="sh-foot">Don\u2019t have both? Just select Play.</div></div>';
  }

  function warnCard(t) {
    return '<div class="sh-card warn"><span class="t">' + t[0] + '</span>' +
      t.slice(1).map(function (l) { return '<span class="l">' + l + '</span>'; }).join('') +
      '<button class="button primary-light" type="button">Exit VR</button></div>';
  }

  function step(kind, text, sub) {
    var m = mk(kind);
    return '<div class="sh-step ' + (kind === 'todo' ? 'todo' : '') + '"><span class="mk">' + m + '</span><span class="tx">' + text + '</span></div>' +
      (sub ? '<div class="sh-sub">' + sub + '</div>' : '');
  }

  function checklist(state) {
    var req = state === 'connect' ? '<div class="sh-req">Needs a MIDI keyboard and USB-C cable.</div>' : '';
    var a = state === 'connect' ? 'cur' : 'done';
    var b = state === 'connect' ? 'todo' : state === 'press' ? 'cur' : 'done';
    return '<div class="sh-card">' + req +
      step(a, 'Connect keyboard', state === 'connect' ? 'Plug it in with the cable.' : '') +
      step(b, 'Press any key', state === 'press' ? 'Checking it sends notes.' : '') + '</div>';
  }

  function boxes(o) {
    var names = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
    return '<div class="sh-boxes">' +
      '<div class="sh-box1 sh-grow"><span class="lb">E2</span><div class="ln"><i></i></div></div>' +
      '<div class="sh-box2 sh-grow">' + names.map(function (n) {
        return '<div class="sh-col">' + img('tuner-check') + '<b>' + n + '</b><i></i></div>';
      }).join('') + '</div></div>';
  }

  function ready(o) {
    if (o.input === 'none') return true;
    if (o.input === 'mic') return o.state === 'ready';
    return o.state === 'done';
  }
  function isSub(o) { return !(o.input === 'none' || (o.input === 'mic' && (o.state === 'ready' || o.state === 'headset'))); }

  function screen(o) {
    var body = '';
    if (o.input === 'none') body += '<div class="sh-card warn"><span class="l">Scoring is disabled</span></div>';
    else if (o.input === 'mic') {
      if (o.state === 'req') body += reqCard();
      else if (o.state === 'ready' || o.state === 'headset') body += micCard(o);
      else body += warnCard(MIC_TEXT[o.state]);
    } else {
      body += (o.state === 'prompt' || o.state === 'blocked') ? warnCard(MIDI_TEXT[o.state]) : checklist(o.state);
    }
    body = ((S.trim === 'trim' && o.state === 'req') ? '' : inputRow(o)) + '<div class="sh-mid">' + body + '</div>';
    var hideRepo = S.calib === 'no' || (S.repoSub === 'hide' && isSub(o));
    var sq = S.retune === 'all';
    var left = hideRepo ? '<span class="sh-ph' + (sq ? ' sq' : '') + '"></span>'
      : btn('primary-dark', 'recal-icon', sq ? '' : 'Reposition');
    var play = btn('primary-light', 'play-icon', 'Play');
    var html = frame('Song', '<div class="sh-body">' + body + '</div>', left + play);
    return o.modal ? withModal(html, o.modal) : html;
  }

  function tuner(modal) {
    var sq = S.retune !== 'label';
    var re = '<button class="button primary-dark icon-btn' + (sq ? ' sh-sq' : '') + '" type="button">' + img('tuner-restart') + (sq ? '' : '<span>Retune</span>') + '</button>';
    var play = btn('primary-light', 'play-icon', 'Play');
    var html = frame('Setup', '<div class="sh-body sh-tunerbody">' + boxes() + '</div>', re + play);
    return modal ? withModal(html, { kind: 'bt' }) : html;
  }

  function frame(back, inner, bar, head) {
    return '<div class="frame"><div class="content"><div class="header"><div class="sh-hrow"><button class="button primary-dark" type="button">' +
      '<img src="' + P + 'back-arrow.svg" alt=""><span class="back-label">' + back + '</span></button>' + (head || '') + '</div></div>' + inner +
      '</div><div class="actions">' + bar + '</div></div>';
  }

  function withModal(html, m) {
    var card;
    if (m.kind === 'tuner') {
      var sq = S.retune !== 'label';
      card = '<div class="sh-bigmodal">' + boxes() + '<div class="sh-mbar"><button class="button primary-dark icon-btn' + (sq ? ' sh-sq' : '') + '" type="button">' +
        img('tuner-restart') + (sq ? '' : '<span>Retune</span>') + '</button><button class="button primary-light icon-btn" type="button">' + img('tuner-check', 'sh-ic sh-dark') + '<span>Done</span></button></div></div>';
    } else if (m.kind === 'steps') {
      card = '<div class="sh-modal"><span class="t">Mic not listed?</span><span class="l">Settings > Experimental ></span>' +
        '<span class="l">External Microphone, then restart headset.</span><div class="bar"><button class="button primary-light" type="button">OK</button></div></div>';
    } else if (m.kind === 'info') {
      card = '<div class="sh-modal"><span class="t">External mic</span><span class="l">Headset mic can\u2019t hear instruments</span>' +
        '<span class="l">Plugs in to the headset\u2019s USB-C port</span><div class="bar"><button class="button primary-light" type="button">OK</button></div></div>';
    } else if (m.kind === 'bt') {
      card = '<div class="sh-modal"><span class="t">Bluetooth Audio Reminder</span><span class="l">The external mic mutes the speakers</span>' +
        '<span class="l">Pair Bluetooth audio to hear music</span><div class="bar"><button class="button primary-light" type="button">Play</button></div></div>';
    } else {
      card = '<div class="sh-modal"><span class="t">' + m.name + ' isn’t ready</span><span class="l">Skip scoring?</span>' +
        '<div class="bar"><button class="button primary-dark" type="button">Fix</button><button class="button primary-light" type="button">Skip</button></div></div>';
    }
    return html.replace(/<\/div>$/, '<div class="sh-scrim">' + card + '</div></div>');
  }

  function song() {
    var sq = S.retune === 'all';
    var setup = btn('primary-dark', 'setup-icon', sq ? '' : 'Setup');
    var play = btn('primary-light', 'play-icon', 'Play');
    var body = '<div class="sh-song"><div class="sh-songrow"><div class="sh-art"></div><div><b>tkm</b><span>boy pablo</span></div></div>' +
      '<div class="sh-opts">' + dd('Keys', null, '', 140) + dd('Normal', null, '', 140) + '</div></div>';
    return frame('Library', body, setup + play);
  }

  // id, group, title, note, html builder
  var F = [
    ['song', 'Song page', 'Song page, Keys', 'Setup (wrench) takes the secondary slot. Reposition and Tune are gone from this page. Play never shows the not-ready modal here.', song],

    ['keys-none', 'Setup for Keys', 'Input None', 'No cards, no permission. Play is light.', function () { return screen({ part: 'keys', input: 'none' }); }],
    ['keys-menu', 'Setup for Keys', 'Input menu open', 'Opens downward over the card region. Keys offers None, Mic and MIDI.', function () { return screen({ part: 'keys', input: 'mic', state: 'ready', menu: 'input' }); }],
    ['keys-mic', 'Setup for Keys', 'Mic ready', 'USB mic ready. Card holds device, level and Gain. Nothing below it on Keys.', function () { return screen({ part: 'keys', input: 'mic', state: 'ready' }); }],
    ['keys-midi-connect', 'Setup for Keys', 'MIDI: connect', 'Requirements line shows until a keyboard connects. Play is dark.', function () { return screen({ part: 'keys', input: 'midi', state: 'connect' }); }],
    ['keys-midi-press', 'Setup for Keys', 'MIDI: press a key', 'Opens here when a keyboard is already attached.', function () { return screen({ part: 'keys', input: 'midi', state: 'press' }); }],
    ['keys-midi-done', 'Setup for Keys', 'MIDI: done', 'Stays on this state until Play, so the success is visible.', function () { return screen({ part: 'keys', input: 'midi', state: 'done' }); }],
    ['keys-midi-prompt', 'Setup for Keys', 'MIDI: prompt', 'Exit VR makes the request.', function () { return screen({ part: 'keys', input: 'midi', state: 'prompt' }); }],
    ['keys-midi-blocked', 'Setup for Keys', 'MIDI: blocked', 'Exit VR ends the session, the flat page shows the steps.', function () { return screen({ part: 'keys', input: 'midi', state: 'blocked' }); }],
    ['modal-midi', 'Setup for Keys', 'Play with MIDI not ready', 'Blocking card, only when leaving Setup early. Fix stays on Setup, Skip plays unscored.', function () { return screen({ part: 'keys', input: 'midi', state: 'press', modal: { name: 'MIDI' } }); }],

    ['mic-req', 'Mic, Keys and guitar', 'Requirements', 'One flow for both parts. First state of the card, with no Continue button. Keys wording is unverified, the Quest mic result so far is from guitar.', function () { return screen({ part: 'keys', input: 'mic', state: 'req' }); }],
    ['mic-req-info', 'Mic, Keys and guitar', 'Requirements, info modal', 'Only with the Info icon style. Tapping an (i) opens a modal like this. Bluetooth audio has its own.', function () {
      var k = S.req; S.req = 'info';
      try { return screen({ part: 'keys', input: 'mic', state: 'req', modal: { kind: 'info' } }); } finally { S.req = k; }
    }],
    ['mic-prompt', 'Mic, Keys and guitar', 'Prompt', 'Same card shape as MIDI. Text is the tuner\u2019s MIC_CARD_TEXT.', function () { return screen({ part: 'keys', input: 'mic', state: 'prompt' }); }],
    ['mic-siteBlocked', 'Mic, Keys and guitar', 'siteBlocked', 'Three lines, the longest card.', function () { return screen({ part: 'keys', input: 'mic', state: 'siteBlocked' }); }],
    ['mic-appBlocked', 'Mic, Keys and guitar', 'appBlocked', 'Keys only exists for the mic. MIDI has no OS toggle.', function () { return screen({ part: 'keys', input: 'mic', state: 'appBlocked' }); }],
    ['mic-headset', 'Mic, Keys and guitar', 'Headset mic selected', 'Built-in mic warning inside the card. The device dropdown stays so the USB mic can be picked, and the card clears when one is. No Dismiss, Play is the way out.', function () { return screen({ part: 'keys', input: 'mic', state: 'headset' }); }],
    ['mic-headset-info', 'Mic, Keys and guitar', 'Headset mic, steps modal', 'Tapping the (i) on the plug-in line opens the Quest setting steps.', function () { return screen({ part: 'keys', input: 'mic', state: 'headset', modal: { kind: 'steps' } }); }],
    ['mic-device-menu', 'Mic, Keys and guitar', 'Device menu open', 'The device list opens downward over the card.', function () { return screen({ part: 'keys', input: 'mic', state: 'headset', menu: 'device' }); }],
    ['guitar-none', 'Setup for guitar', 'Input None', 'Guitar offers None and Mic only.', function () { return screen({ part: 'guitar', input: 'none' }); }],
    ['guitar', 'Setup for guitar', 'USB mic ready, guitar', 'Tune opens the tuner screen. The bar keeps two buttons.', function () { return screen({ part: 'guitar', input: 'mic', state: 'ready' }); }],
    ['guitar-tuned', 'Setup for guitar', 'USB mic ready, tuned', 'Only differs with the Tuning switch on Checklist row.', function () { return screen({ part: 'guitar', input: 'mic', state: 'ready', tuned: true }); }],
    ['guitar-tuner-modal', 'Setup for guitar', 'Tuner as a large modal', 'Exploration: tuner on top of Setup. Song stays in the corner, so no exception. Done returns to Setup and Play stays on Setup, which is where the Bluetooth reminder then lives.', function () { return screen({ part: 'guitar', input: 'mic', state: 'ready', modal: { kind: 'tuner' } }); }],
    ['guitar-tuner', 'Setup for guitar', 'Tuner screen (option A)', 'Full-size boxes alone. Corner reads Setup, the one exception to Song. Play starts the song, so Play acts as Done.', function () { return tuner(false); }],
    ['guitar-bt', 'Setup for guitar', 'Bluetooth reminder', 'One-time modal when leaving with an external mic, from Play on Setup or on the tuner.', function () { return screen({ part: 'guitar', input: 'mic', state: 'ready', modal: { kind: 'bt' } }); }],
    ['modal-mic', 'Setup for guitar', 'Leaving with mic not ready', 'Same modal with the name swapped.', function () { return screen({ part: 'guitar', input: 'mic', state: 'siteBlocked', modal: { name: 'Mic' } }); }]
  ];

  var SW = [
    ['retune', 'Retune button (tuner screen)', [['label', 'Labelled'], ['icon', 'Icon only'], ['all', 'Icon only, plus Reposition and Setup']]],
    ['card', 'Mic card', [['one', 'One row'], ['two', 'Two rows']]],
    ['calib', 'Saved calibration', [['yes', 'Yes'], ['no', 'No']]],
    ['repoSub', 'Reposition on permission and checklist screens', [['show', 'Shown'], ['hide', 'Hidden']]],
    ['labels', 'Labels', [['input-mic', 'Input + Mic'], ['input-device', 'Input + Device'], ['input-none', 'Input only'], ['source-mic', 'Source + Mic']]],
    ['req', 'Requirements card', [['full', 'Two lines'], ['cut', 'One line'], ['info', 'Info icon']]],
    ['tune', 'Tuning', [['button', 'Button'], ['row', 'Checklist row']]],
    ['zoom', 'Zoom', [['1', '1x'], ['1.5', '1.5x'], ['2', '2x']]]
  ];

  var strip = document.getElementById('strip'), stage = document.getElementById('stage');

  function groups() {
    var g = [];
    F.forEach(function (f) { var x = g.filter(function (y) { return y[0] === f[1]; })[0]; if (!x) g.push(x = [f[1], []]); x[1].push(f); });
    return g;
  }

  function drawStrip(cur) {
    var h = '<div class="mk-group"><b>Frames</b><a href="#all"' + (cur === 'all' ? ' class="on"' : '') + '>All</a></div>';
    groups().forEach(function (g) {
      h += '<div class="mk-group"><b>' + g[0] + '</b>' + g[1].map(function (f) {
        return '<a href="#' + f[0] + '"' + (f[0] === cur ? ' class="on"' : '') + '>' + f[2] + '</a>';
      }).join('') + '</div>';
    });
    h += '<div class="mk-group mk-decisions"><b>Decisions</b>' + SW.map(function (s) {
      return '<label>' + s[1] + '<select data-k="' + s[0] + '">' + s[2].map(function (o) {
        return '<option value="' + o[0] + '"' + (S[s[0]] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>';
    }).join('') + '</div>';
    strip.innerHTML = h;
  }

  function fr(f) {
    return '<section class="fr" id="' + f[0] + '"><div class="holder">' + f[4]() + '</div><div class="cap"><b>' + f[2] + '</b>. ' + f[3] +
      '<span class="fit"></span></div></section>';
  }

  function measure() {
    stage.style.setProperty('--z', 1);
    stage.querySelectorAll('.frame').forEach(function (f) { f.style.setProperty('--z', 1); });
    document.querySelectorAll('.fr').forEach(function (s) {
      var c = s.querySelector('.content'), b = s.querySelector('.sh-body, .sh-song'), hd = s.querySelector('.header');
      if (!c || !b) return;
      // Natural height: header plus body with growing boxes held at their content minimum.
      var grows = s.querySelectorAll('.sh-grow');
      grows.forEach(function (g) { g.style.flex = '0 0 auto'; });
      b.style.flex = '0 0 auto';
      var need = hd.offsetHeight + b.offsetHeight, avail = c.clientHeight;
      b.style.flex = '';
      grows.forEach(function (g) { g.style.flex = ''; });
      var wide = false;
      s.querySelectorAll('.sh-card').forEach(function (k) { if (k.scrollWidth > k.clientWidth + 1) wide = true; });
      var d = avail - need, t = d >= 0 ? 'fits, ' + Math.round(d / 10 * 10) / 10 + ' cm spare' : 'OVERFLOWS by ' + Math.round(-d / 10 * 10) / 10 + ' cm';
      t += ' (body needs ' + Math.round(need / 10 * 10) / 10 + ' of ' + Math.round(avail / 10 * 10) / 10 + ' cm)' + (wide ? ', card too wide' : '');
      var el = s.querySelector('.fit'); el.textContent = t;
      var bm = s.querySelector('.sh-bigmodal');
      if (bm) { var fh = s.querySelector('.frame').clientHeight, mh = bm.offsetHeight; el.textContent = 'modal ' + Math.round(mh / 10 * 10) / 10 + ' of ' + Math.round(fh / 10 * 10) / 10 + ' cm panel'; s.classList.toggle('over', mh > fh - 20); return; }
      s.classList.toggle('over', d < 0 || wide);
    });
    stage.style.setProperty('--z', S.zoom);
    stage.querySelectorAll('.frame').forEach(function (f) { f.style.setProperty('--z', S.zoom); });
  }

  function render() {
    var cur = (location.hash || '#all').slice(1);
    var one = F.filter(function (f) { return f[0] === cur; })[0];
    drawStrip(one ? cur : 'all');
    stage.style.setProperty('--z', S.zoom);
    stage.className = one ? 'single' : '';
    if (one) stage.innerHTML = fr(one);
    else {
      stage.innerHTML = '<p class="mk-note">Static mock of the XR Setup hub panels (40 x 30 cm, 1 cm = 10 px). It agrees layout and content, not focus or keyboard behaviour. The fit line under each frame is measured in this page at 1.3 line height, so it is an estimate and not a uikit result.</p>' +
        groups().map(function (g) { return '<div class="mk-sect"><h2>' + g[0] + '</h2><div class="mk-grid">' + g[1].map(fr).join('') + '</div></div>'; }).join('');
    }
    stage.querySelectorAll('.frame').forEach(function (f) { f.style.setProperty('--z', S.zoom); });
    measure();
  }

  strip.addEventListener('change', function (e) {
    var k = e.target.getAttribute('data-k'); if (!k) return;
    S[k] = e.target.value; render();
  });
  window.addEventListener('hashchange', render);
  render();
})();
