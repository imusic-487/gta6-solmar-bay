// Solmar Bay — procedural sound effects (slice 9).
//
//   const audio = createAudio();
//   Returns { init, resume, play, setMuted, isMuted, isReady,
//             getPlayCount, getPlayCounts, sounds }.
//
//   Wiring (done by the wiring session, NOT here):
//     - init() / resume() — call once from a user gesture: the title
//       screen click / Enter that starts the game (see main.js
//       startFromTitle). The AudioContext is created ONLY here, never
//       at module load, so the browser autoplay policy is satisfied
//       and nothing sounds before the player starts. Calling init()
//       twice is safe: the second call just resumes the same context.
//     - play('punch') — combat tryPunch, on a punch that lands.
//     - play('knockout') — combat onKnockout callback.
//     - play('missionComplete') — missions onComplete callback.
//     - play('failed') — death onDeath callback when kind is 'failed'
//       (DELIVERY FAILED screen).
//     - play('dead') — death onDeath callback when kind is 'dead'
//       (OUT COLD screen).
//     - setMuted(true/false) — the M key handler in main.js; this
//       module never listens for keys itself.
//     - getPlayCount(name) — how many times play(name) was requested;
//       used by Playwright checks to verify each event really fires
//       its sound. The count increments on every play() request for
//       a known name, even while muted or with no audio device, so
//       it proves the wiring fired — it is not a loudness meter.
//
//   All five sounds are synthesized live with WebAudio oscillators
//   and filtered noise — zero audio files, zero network, no
//   background music, no engine hum, no siren loop. Every sound is
//   short (< ~1.1 s) and built from a different waveform / pitch
//   envelope / duration so each is identifiable by ear:
//     punch           square 160->70 Hz + low noise burst, 0.12 s
//     knockout        double low thud, square+sine 220->40 Hz, 0.45 s
//     missionComplete rising major triad, sine, 523->659->784 Hz, 0.6 s
//     failed          two descending saw notes, 330->110 Hz, 0.9 s
//     dead            long low sine drone, 110->55 Hz + thud, 1.1 s
//
//   Robustness: every public method is safe to call before init(),
//   when the AudioContext is unavailable (headless, disabled audio),
//   or when resume() is blocked by the autoplay policy — it degrades
//   silently, never throws, and never touches the game loop. A
//   missing or suspended context only means silence, never an error.

export const AUDIO_SOUNDS = ['punch', 'knockout', 'missionComplete', 'failed', 'dead'];

const MASTER_VOLUME = 0.5;

export function createAudio() {
  let ctx = null;        // AudioContext, created only by init()/resume()
  let master = null;     // master GainNode (mute lives here)
  let noiseBuf = null;   // cached 1 s white-noise buffer, built with ctx
  let muted = false;
  const counts = {};     // name -> play() requests, for test verification

  function audioCtor() {
    try {
      const g = typeof globalThis !== 'undefined' ? globalThis : null;
      if (!g) return null;
      return g.AudioContext || g.webkitAudioContext || null;
    } catch (err) {
      return null;
    }
  }

  // Create the context (user gesture only — the caller guarantees
  // this runs from a click / Enter) and the master gain. Returns
  // true when audio is usable, false when it is not (headless,
  // disabled, or the browser refused). Never throws.
  function init() {
    if (ctx) {
      resume();
      return true;
    }
    try {
      const Ctor = audioCtor();
      if (!Ctor) return false;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);
      const len = Math.max(1, Math.floor(ctx.sampleRate));
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      resume();
      return true;
    } catch (err) {
      ctx = null;
      master = null;
      noiseBuf = null;
      return false;
    }
  }

  // Resume a suspended context (autoplay policy). Safe before init()
  // (creates the context, same as init) and safe when resume is
  // refused — a rejected promise is swallowed, never thrown.
  // Returns true when the context exists afterwards, false otherwise.
  function resume() {
    if (!ctx) return init();
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  // One oscillator voice: type, pitch glide, gain envelope (quick
  // attack, exponential decay to silence). t0 is ctx.currentTime.
  function tone(t0, opts) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd && opts.freqEnd !== opts.freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + opts.dur);
    }
    const vol = typeof opts.vol === 'number' ? opts.vol : 0.5;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  // One filtered-noise burst: white noise through a lowpass whose
  // cutoff glides down, with the same quick-attack/decay envelope.
  function noise(t0, opts) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(opts.filterFreq || 800, t0);
    if (opts.filterEnd) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.filterEnd), t0 + opts.dur);
    }
    const gain = ctx.createGain();
    const vol = typeof opts.vol === 'number' ? opts.vol : 0.4;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.005));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  // The five sounds. Each takes t0 = ctx.currentTime and schedules
  // only short, one-shot voices — nothing loops, nothing sustains.
  const SYNTH = {
    // Short low thump: square wave dropping 160->70 Hz under a
    // lowpass noise burst — a fist landing, 0.12 s.
    punch(t0) {
      tone(t0, { type: 'square', freq: 160, freqEnd: 70, dur: 0.1, vol: 0.45 });
      noise(t0, { filterFreq: 900, filterEnd: 200, dur: 0.12, vol: 0.4 });
    },
    // Two heavy thuds a beat apart: square 220->50 Hz plus a sine
    // 90->40 Hz boom underneath — a body hitting the ground, 0.45 s.
    knockout(t0) {
      tone(t0, { type: 'square', freq: 220, freqEnd: 50, dur: 0.18, vol: 0.5 });
      tone(t0, { type: 'sine', freq: 90, freqEnd: 40, dur: 0.25, vol: 0.6 });
      tone(t0 + 0.14, { type: 'square', freq: 140, freqEnd: 45, dur: 0.2, vol: 0.45 });
      tone(t0 + 0.14, { type: 'sine', freq: 70, freqEnd: 38, dur: 0.28, vol: 0.55 });
    },
    // Rising major triad, clean sine: C5 523 -> E5 659 -> G5 784 Hz,
    // three 0.18 s notes staggered 0.09 s — a delivery done, 0.6 s.
    missionComplete(t0) {
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        tone(t0 + i * 0.09, { type: 'sine', freq, dur: 0.22, vol: 0.45 });
        tone(t0 + i * 0.09, { type: 'triangle', freq: freq * 2, dur: 0.15, vol: 0.12 });
      });
    },
    // Two descending saw notes, 330 -> 220 -> 110 Hz through a
    // lowpass — a run ending badly, 0.9 s.
    failed(t0) {
      tone(t0, { type: 'sawtooth', freq: 330, freqEnd: 220, dur: 0.4, vol: 0.3 });
      tone(t0 + 0.38, { type: 'sawtooth', freq: 220, freqEnd: 110, dur: 0.5, vol: 0.3 });
      tone(t0 + 0.38, { type: 'sine', freq: 110, freqEnd: 55, dur: 0.5, vol: 0.35 });
    },
    // One long low drone: sine 110 -> 55 Hz for a full second, with
    // a soft low thud at the start — the screen going dark, 1.1 s.
    // Lower and longer than 'failed', so the two never blur.
    dead(t0) {
      tone(t0, { type: 'sine', freq: 110, freqEnd: 55, dur: 1.05, vol: 0.5, attack: 0.02 });
      tone(t0, { type: 'sine', freq: 55, freqEnd: 38, dur: 0.9, vol: 0.4, attack: 0.02 });
      noise(t0, { filterFreq: 300, filterEnd: 80, dur: 0.35, vol: 0.25 });
    },
  };

  // Play one named sound. Unknown names are ignored (false, no
  // count, no throw). Muted, or no usable context, means silence —
  // but the request is still counted, so the wiring can be verified
  // in headless runs where nothing can actually sound. Never throws.
  function play(name) {
    if (typeof name !== 'string' || !SYNTH[name]) return false;
    counts[name] = (counts[name] || 0) + 1;
    if (muted || !ctx || !master) return false;
    try {
      if (ctx.state === 'suspended') resume();
      SYNTH[name](ctx.currentTime);
      return true;
    } catch (err) {
      return false;
    }
  }

  // Mute switch. Muted play() calls stay counted no-ops; unmuting
  // restores the master gain. Returns the new muted state.
  function setMuted(m) {
    muted = !!m;
    try {
      if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
    } catch (err) {
      // A dead context keeps the flag; sound stays off either way.
    }
    return muted;
  }

  function isMuted() { return muted; }

  // True only when a context exists and is actually running —
  // i.e. a play() right now could be heard (when not muted).
  function isReady() {
    try {
      return !!ctx && ctx.state === 'running';
    } catch (err) {
      return false;
    }
  }

  // Play-request counts, for Playwright / test verification.
  function getPlayCount(name) {
    if (typeof name !== 'string') return 0;
    return counts[name] || 0;
  }

  function getPlayCounts() {
    const out = {};
    for (const n of AUDIO_SOUNDS) out[n] = counts[n] || 0;
    return out;
  }

  return {
    init,
    resume,
    play,
    setMuted,
    isMuted,
    isReady,
    getPlayCount,
    getPlayCounts,
    sounds: AUDIO_SOUNDS.slice(),
  };
}
