
class Config {
    constructor({
        midiIndex = 0,
        tempo = 120,
        beatDivisions = 4,
        beatsPerMeasure = 4,
        toleranceMs = 33,
        visualizationOffsetBeats = 0.5,
        historyMeasures = 2
    } = {}) {
        const savedConfig = JSON.parse(localStorage.getItem('config')) || {};

        // Initialize properties, either from saved config or default values
        this.midiIndex = savedConfig.midiIndex || midiIndex;
        this.tempo = savedConfig.tempo || tempo;
        this.beatDivisions = savedConfig.beatDivisions || beatDivisions;
        this.beatsPerMeasure = savedConfig.beatsPerMeasure || beatsPerMeasure;
        this.toleranceMs = savedConfig.toleranceMs || toleranceMs;
        this.visualizationOffsetBeats = savedConfig.visualizationOffsetBeats || visualizationOffsetBeats;
        this.historyMeasures = savedConfig.historyMeasures || historyMeasures;

        this.callbacks = [];
    }

    // Register a callback
    onUpdate(callback) {
        if (typeof callback === 'function') {
            this.callbacks.push(callback);
        }
    }

    // Update setting with callback and persistence support
    updateSetting(key, value) {
        if (this.hasOwnProperty(key)) {
            this[key] = value;
            this._saveToLocalStorage();
            this._triggerCallbacks(key, value);
        } else {
            console.warn(`Setting "${key}" does not exist.`);
        }
    }

    // Internal method to save to localStorage
    _saveToLocalStorage() {
        localStorage.setItem('config', JSON.stringify(this));
    }

    // Internal method to trigger callbacks
    _triggerCallbacks(key, value) {
        this.callbacks.forEach(callback => callback(key, value));
    }
}


/**
 * MIDI monitor
 * 
 * Records midi messages and their timestamp.
 */
class DrumMidiMonitor {
    midiAccess = null;
    midiInput = null;
    midiCounter = 0;
    messages = [];
    config = new Config();
    canvas = null;
    canvasCtx = null;
    audioCtx = null;

    // Dynamic
    width;
    height;
    beatDuration;
    measureDuration;
    timeToXScalar;
    tStartMillis;
    metronomeCount;
    metronomeStartTimeAudioCtx;
    metronomeAudioCtxTimeOffset;
    metronomeNextBeatTime;
    historyCutoffTime;

    constructor(canvas, audioCtx) {
        this._initMidi();
        this.config.onUpdate(this.reset.bind(this));
        this.canvasCtx = canvas.getContext('2d');
        this.audioCtx = audioCtx;
        this.width = canvas.width;
        this.height = canvas.height;
    }

    start() {
        console.log("resume");
        this.audioCtx.resume();
        this.reset();
        requestAnimationFrame(this.animate.bind(this));
    }

    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
        this.timeToXScalar = this.width / this.measureDuration;
    }

    animate() {
        const tNow = performance.now();
        this.canvasCtx.fillStyle = 'black';
        this.canvasCtx.fillRect(0, 0, this.width, this.height);
        // drawBaseImage();
        // plotMetronomeBar(tNow);
        // plotMessages(tNow);
        requestAnimationFrame(this.animate.bind(this));
    }

    reset() {
        this.beatDuration = 60 / this.config.tempo;
        this.measureDuration = this.beatDuration * this.config.beatsPerMeasure;
        this.historyCutoffTime = this.measureDuration * this.config.historyMeasures;

        this.tStartMillis = performance.now();
        this.metronomeStartTimeAudioCtx = this.audioCtx.currentTime;
        this.metronomeAudioCtxTimeOffset = this.tStartMillis / 1000 - this.metronomeStartTimeAudioCtx;
        this.metronomeCount = 0;
        this.metronomeNextBeatTime = this.metronomeStartTimeAudioCtx;

        this.messages = [];
    }

    getTimeInfo(tMillis) {
        const tRelMillis = tMillis - this.tStartMillis;
        const tRel = tRelMillis / 1000;
        const count = (tRel / this.beatDuration) % this.config.beatsPerMeasure;
        const nearestCount = Math.round(count);
        const nearestCountDT = (count - nearestCount) * this.beatDuration
        const division = (count * this.config.beatDivisions) % this.config.beatDivisions;
        const nearestDivision = Math.round(division);
        const nearestDivisionDT = (division - nearestDivision) * this.beatDuration / this.config.beatDivisions;
        const posNorm = (this.config.visualizationOffsetBeats / this.config.beatsPerMeasure) + count / this.config.beatsPerMeasure;
        const x = posNorm * this.width;
        return { tRel, count, nearestCount, nearestCountDT, division, nearestDivision, nearestDivisionDT, x };
    }

    // #region Midi
    _initMidi() {
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess().then(
                this.onMIDISuccess.bind(this),
                this.onMIDIFailure.bind(this)
            );
        } else {
            alert('Web MIDI API not supported in this browser.');
        }
    }

    onMIDISuccess(midi) {
        this.midiAccess = midi;
        const inputs = this.midiAccess.inputs.values();
        for (let input of inputs) {
            this.midiInput = input;
            break; // Take the first available input
        }
        if (this.midiInput) {
            this.midiInput.onmidimessage = this.onMIDIMessage.bind(this);
        } else {
            alert('No MIDI input devices found.');
        }
    }

    // Handle MIDI failure
    onMIDIFailure() {
        alert('Failed to access MIDI devices.');
    }

    onMIDIMessage(event) {
        const time = event.timeStamp;
        const [status, note, velocity] = event.data;
        const command = status >> 4;

        switch (status) {
            case 248: // Timing pulse (24/quarter note)
                this.midiCounter += 1;
                break;
            case 250: // Timing start
                this.midiCounter = 0;
                break;
            case 251: // Timing continue
                break;
            case 252: // Timing stop
                break;
        }

        if (command === 9 && velocity > 0) { // Note On with velocity > 0
            const timeInfo = this.getTimeInfo(time);
            const offsetMillis = time - performance.now();
            const midi_count = this.midiCounter;
            this.messages.push({ time, note, midi_count, offsetMillis, ...timeInfo });
            console.log(this.messages.at(-1));
        }
    }
    // #endregion


}