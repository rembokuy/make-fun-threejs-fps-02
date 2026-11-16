// The DOM HUD: health, armour, ammo, money, timer, score, team counts, the
// kill feed, the crosshair, the buy menu and the overlay panels. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
// Every setter caches its last value and skips the DOM when nothing changed.
import { BUY_ITEMS } from './rounds.js';

const OVERLAY_COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'Foundry Yard — plant the charge at Crane Yard or the Silo, or wipe the Wardens out. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  dead: {
    title: 'You are down',
    copy: 'Your squad fights on. You return next round.',
    action: 'Keep watching',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorFill = $('armor-fill');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const scoreEl = $('score');
  const roundEl = $('round');
  const aliveAtk = $('alive-atk');
  const aliveDef = $('alive-def');
  const bombEl = $('bomb-status');
  const grenadeEl = $('grenade-count');
  const feedEl = $('killfeed');
  const hitmarker = $('hitmarker');
  const damageEl = $('damage');
  const crosshair = $('crosshair');
  const progressEl = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const buyEl = $('buy');
  const buyMoney = $('buy-money');
  const buyGrid = $('buy-grid');

  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function buildBuy(onBuy) {
    buyGrid.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.id = item.id;
      button.innerHTML = `<b></b><span></span><i></i>`;
      button.querySelector('b').textContent = item.name;
      button.querySelector('span').textContent = item.desc;
      button.querySelector('i').textContent = `$${item.price}`;
      button.addEventListener('click', () => onBuy(item.id));
      buyGrid.appendChild(button);
    }
  }

  return {
    setHealth(hp, armor) {
      if (last.hp !== hp) {
        last.hp = hp;
        healthFill.style.width = `${Math.max(0, hp)}%`;
        healthFill.classList.toggle('low', hp <= 30);
        healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      }
      if (last.armor !== armor) {
        last.armor = armor;
        armorFill.style.width = `${Math.max(0, armor)}%`;
      }
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', name);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(n) {
      setText(moneyEl, 'money', `$${n}`);
      setText(buyMoney, 'buyMoney', `$${n}`);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = phase === 'buy' ? `BUY ${s}` : phase === 'live' ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
      setText(timerEl, 'timer', text);
      timerEl.classList.toggle('urgent', phase === 'live' && s <= 15);
    },
    setScore(atk, def, round) {
      setText(scoreEl, 'score', `${atk} — ${def}`);
      setText(roundEl, 'round', `ROUND ${round}`);
    },
    setAlive(atkAlive, atkTotal, defAlive, defTotal) {
      setText(aliveAtk, 'aliveAtk', '●'.repeat(atkAlive) + '○'.repeat(Math.max(0, atkTotal - atkAlive)));
      setText(aliveDef, 'aliveDef', '●'.repeat(defAlive) + '○'.repeat(Math.max(0, defTotal - defAlive)));
    },
    setBomb(text, planted) {
      setText(bombEl, 'bomb', text);
      bombEl.classList.toggle('planted', !!planted);
    },
    setGrenades(n) {
      setText(grenadeEl, 'grenades', n > 0 ? `◉ ${n}` : '');
    },
    setCrosshair(gapPx, visible) {
      crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
      crosshair.style.opacity = visible ? '1' : '0';
    },
    hitMarker(killed, headshot) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', !!killed);
      hitmarker.classList.toggle('head', !!headshot);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill', 'head'), 110);
    },
    damageFlash() {
      damageEl.classList.remove('flash');
      void damageEl.offsetWidth;
      damageEl.classList.add('flash');
    },
    banner(title, sub, holdMs = 2200) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub || '';
      bannerEl.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), holdMs);
    },
    killfeed(killer, victim, headshot, killerIsPlayer) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      if (killerIsPlayer) line.classList.add('mine');
      line.textContent = `${killer} ${headshot ? '◎' : '—'} ${victim}`;
      feedEl.prepend(line);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5000);
    },
    showProgress(label, fraction) {
      progressEl.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    hideProgress() {
      progressEl.hidden = true;
    },
    showOverlay(mode, extra) {
      const text = OVERLAY_COPY[mode] || OVERLAY_COPY.start;
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = extra || text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    showEndOverlay(title, copy, action) {
      overlayTitle.textContent = title;
      overlayCopy.textContent = copy;
      playButton.textContent = action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(money, onBuy) {
      if (!buyGrid.hasChildNodes()) buildBuy(onBuy);
      buyMoney.textContent = `$${money}`;
      buyEl.hidden = false;
    },
    hideBuy() {
      buyEl.hidden = true;
    },
    refreshBuy(money, owned, current) {
      buyMoney.textContent = `$${money}`;
      for (const button of buyGrid.children) {
        const item = BUY_ITEMS.find((i) => i.id === button.dataset.id);
        const ownedWeapon = item.kind === 'weapon' && owned.includes(item.id);
        button.classList.toggle('owned', ownedWeapon || (item.kind === 'weapon' && current === item.id));
        button.classList.toggle('cant', money < item.price && !ownedWeapon);
      }
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
  };
}
