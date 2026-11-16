// Synthesised sound: every effect is built from oscillators and filtered noise
// at runtime, so the game ships no audio files and makes no network request.
// One shared AudioContext, created lazily on the first user gesture; every call
// is a no-op until then, so headless captures stay silent and safe.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const length = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function noise(when, duration, filterFreq, gainValue, type = 'lowpass') {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(when);
    source.stop(when + duration + 0.02);
  }

  function tone(when, duration, freqFrom, freqTo, gainValue, type = 'square') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  function play(fn) {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    fn(ctx.currentTime);
  }

  // kind: 'pistol' | 'rifle' | 'smg' | 'sniper' | 'shotgun' | 'enemy'
  function shot(kind, distant = false) {
    play((t) => {
      const table = {
        pistol: [900, 0.5, 0.09],
        rifle: [700, 0.62, 0.11],
        smg: [1100, 0.42, 0.07],
        sniper: [420, 0.9, 0.22],
        shotgun: [320, 0.9, 0.2],
        enemy: [800, 0.32, 0.1],
      };
      const [freq, gain, dur] = table[kind] || table.rifle;
      noise(t, dur, freq, distant ? gain * 0.35 : gain);
      tone(t, 0.05, 160, 55, distant ? 0.1 : 0.22, 'sine');
    });
  }

  return {
    unlock() {
      ensure();
    },
    shot,
    dryFire() {
      play((t) => tone(t, 0.04, 1400, 900, 0.12, 'square'));
    },
    reload() {
      play((t) => {
        tone(t, 0.03, 900, 700, 0.14, 'square');
        tone(t + 0.16, 0.03, 700, 500, 0.14, 'square');
        tone(t + 0.55, 0.04, 1100, 900, 0.16, 'square');
      });
    },
    hit(kill) {
      play((t) => {
        tone(t, 0.06, kill ? 1560 : 1180, kill ? 1560 : 1180, 0.2, 'sine');
        if (kill) tone(t + 0.08, 0.1, 1960, 1960, 0.18, 'sine');
      });
    },
    hurt() {
      play((t) => {
        tone(t, 0.16, 220, 90, 0.3, 'sawtooth');
        noise(t, 0.12, 500, 0.2);
      });
    },
    explosion() {
      play((t) => {
        noise(t, 0.7, 240, 1.0);
        noise(t, 0.35, 1400, 0.4, 'highpass');
        tone(t, 0.5, 90, 32, 0.7, 'sine');
      });
    },
    plantBeep(final) {
      play((t) => tone(t, final ? 0.3 : 0.09, final ? 880 : 660, final ? 880 : 660, 0.22, 'sine'));
    },
    defuseBeep() {
      play((t) => tone(t, 0.07, 520, 520, 0.2, 'sine'));
    },
    roundStart() {
      play((t) => {
        tone(t, 0.12, 440, 440, 0.18, 'triangle');
        tone(t + 0.14, 0.2, 660, 660, 0.2, 'triangle');
      });
    },
    roundEnd(win) {
      play((t) => {
        tone(t, 0.16, win ? 523 : 392, win ? 523 : 392, 0.2, 'triangle');
        tone(t + 0.18, 0.3, win ? 784 : 311, win ? 784 : 311, 0.22, 'triangle');
      });
    },
    buy() {
      play((t) => {
        tone(t, 0.05, 980, 980, 0.16, 'sine');
        tone(t + 0.06, 0.08, 1320, 1320, 0.16, 'sine');
      });
    },
    deny() {
      play((t) => tone(t, 0.12, 220, 180, 0.2, 'square'));
    },
    step() {
      play((t) => noise(t, 0.04, 300, 0.05));
    },
  };
}
