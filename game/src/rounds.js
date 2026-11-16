// Rounds and money: the match state machine. One round is a 15 s buy phase,
// up to 100 s live (35 s fuse once the charge is planted), then a short
// intermission. First team to 5 rounds takes the match. Money is earned for
// kills, plants, defuses and round results, and spent in the buy menu; a
// losing streak pays a little more each time, so a comeback stays possible.
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const FUSE_TIME = 35;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export const BUY_ITEMS = [
  { id: 'rifle', name: 'VK-47 Rifle', price: WEAPONS.rifle.price, kind: 'weapon', desc: 'Full-auto rifle. The workhorse.' },
  { id: 'smg', name: 'Kestrel SMG', price: WEAPONS.smg.price, kind: 'weapon', desc: 'Fast, close-range spray.' },
  { id: 'shotgun', name: 'Breacher 12', price: WEAPONS.shotgun.price, kind: 'weapon', desc: 'Eight pellets up close.' },
  { id: 'sniper', name: 'Longbow DMR', price: WEAPONS.sniper.price, kind: 'weapon', desc: 'One shot, long sightline. Right-click to zoom.' },
  { id: 'grenade', name: 'Frag Grenade', price: GRENADE_PRICE, kind: 'grenade', desc: 'Bounces, then bursts. G to throw.' },
  { id: 'armor', name: 'Plate Vest', price: ARMOR_PRICE, kind: 'armor', desc: 'Absorbs half of each hit.' },
];

export function createRounds(ctx) {
  const state = {
    phase: 'menu', // menu | buy | live | over | match
    round: 0,
    score: { atk: 0, def: 0 },
    money: 800,
    lossStreak: 0,
    kills: 0,
    deaths: 0,
    timer: 0,
    phaseTime: 0,
    bomb: {
      carrier: null, // 'player' or a bot object
      planted: false,
      site: null,
      fuse: 0,
      dropped: null, // {x, z} when the carrier dies
      plantProgress: 0,
    },
    loadout: {
      weapons: ['pistol'],
      current: 'pistol',
      grenades: 0,
      armor: 0,
    },
    winner: null,
    reason: '',
    matchWinner: null,
  };

  function setPhase(phase, time) {
    state.phase = phase;
    state.phaseTime = time;
    if (phase === 'buy') state.timer = BUY_TIME;
    if (phase === 'live') state.timer = ROUND_TIME;
  }

  function startMatch(time) {
    state.round = 0;
    state.score.atk = 0;
    state.score.def = 0;
    state.money = 800;
    state.lossStreak = 0;
    state.kills = 0;
    state.deaths = 0;
    state.loadout = { weapons: ['pistol'], current: 'pistol', grenades: 0, armor: 0 };
    state.matchWinner = null;
    state.winner = null;
    startRound(time);
  }

  function startRound(time) {
    state.round += 1;
    state.bomb.carrier = 'player';
    state.bomb.planted = false;
    state.bomb.site = null;
    state.bomb.fuse = 0;
    state.bomb.dropped = null;
    state.bomb.plantProgress = 0;
    setPhase('buy', time);
    ctx.onRoundStart(state.round);
  }

  function endRound(winner, reason, time) {
    if (state.phase === 'over' || state.phase === 'match') return;
    state.winner = winner;
    state.reason = reason;
    if (winner === 'atk') {
      state.score.atk += 1;
      state.money += 3250;
      state.lossStreak = 0;
    } else {
      state.score.def += 1;
      state.lossStreak += 1;
      state.money += 1900 + Math.min(1000, (state.lossStreak - 1) * 500);
    }
    setPhase('over', time);
    state.timer = 4;
    ctx.onRoundEnd(winner, reason);
    if (state.score.atk >= WIN_ROUNDS || state.score.def >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.score.atk > state.score.def ? 'atk' : state.score.def > state.score.atk ? 'def' : 'draw';
      setPhase('match', time);
      ctx.onMatchEnd(state.matchWinner);
    }
  }

  function plant(site, time) {
    state.bomb.planted = true;
    state.bomb.site = site;
    state.bomb.fuse = FUSE_TIME;
    state.bomb.carrier = null;
    state.bomb.dropped = null;
    state.money += 300;
    setPhase('live', time);
    state.timer = FUSE_TIME;
    ctx.onPlant(site);
  }

  function buy(id) {
    if (state.phase !== 'buy') return false;
    const item = BUY_ITEMS.find((i) => i.id === id);
    if (!item || state.money < item.price) return false;
    if (item.kind === 'weapon') {
      if (state.loadout.weapons.includes(id)) return false;
      state.loadout.weapons.push(id);
      state.loadout.current = id;
    } else if (item.kind === 'grenade') {
      if (state.loadout.grenades >= 2) return false;
      state.loadout.grenades += 1;
    } else if (item.kind === 'armor') {
      if (state.loadout.armor >= 100) return false;
      state.loadout.armor = 100;
    }
    state.money -= item.price;
    ctx.audio.buy();
    return true;
  }

  function step(dt, time) {
    if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'over') {
      state.timer -= dt;
    }
    if (state.phase === 'buy' && state.timer <= 0) {
      setPhase('live', time);
      ctx.onLive();
    } else if (state.phase === 'live' && state.timer <= 0) {
      if (state.bomb.planted) {
        endRound('atk', 'The charge detonated.', time);
      } else {
        endRound('def', 'Time ran out before the plant.', time);
      }
    } else if (state.phase === 'over' && state.timer <= 0) {
      if (state.phase !== 'match') startRound(time);
    }
  }

  return {
    state,
    startMatch,
    startRound,
    endRound,
    plant,
    buy,
    step,
    canBuy() {
      return state.phase === 'buy';
    },
    isLive() {
      return state.phase === 'live';
    },
  };
}
