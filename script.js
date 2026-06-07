let audioCtx, masterGain, mixDest, noiseBuffer;
const STEPS = 16, STEP_WIDTH_PX = 40;
let tempo = 120, isPlaying = false, isRecording = false, activeRecTrack = null;
let currentStep = 0, nextNoteTime = 0.0, timerID, loopStartTime = 0;

const drumTracks = [
    { id: 'hihat', type: 'hihat', pitch: 1.0, pattern: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false] },
    { id: 'snare', type: 'snare', pitch: 1.0, pattern: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] },
    { id: 'kick', type: 'kick', pitch: 1.0, pattern: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false] }
];

let vocalTracks = [
    { id: 'vt-0', volume: 1.0, pitch: 1.0, echo: 0, gainNode: null, delayNode: null },
    { id: 'vt-1', volume: 1.0, pitch: 1.0, echo: 0, gainNode: null, delayNode: null }
];

let audioClips = [];
let clipIdCounter = 0, mediaRec, audioChunks = [];

const drumContainer = document.getElementById('drum-container');
const vocalContainer = document.getElementById('vocal-container');
const playheadDrums = document.getElementById('playhead-drums');
const playheadVocals = document.getElementById('playhead-vocals');

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain(); masterGain.connect(audioCtx.destination);
        mixDest = audioCtx.createMediaStreamDestination(); masterGain.connect(mixDest);
        createNoise(); initVocalRouting();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function createNoise() {
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < output.length; i++) output[i] = Math.random() * 2 - 1;
}

function initVocalRouting() {
    vocalTracks.forEach(track => {
        if(track.gainNode) return;
        track.gainNode = audioCtx.createGain();
        track.delayNode = audioCtx.createDelay(5.0); track.delayNode.delayTime.value = 0;
        const feedback = audioCtx.createGain(); feedback.gain.value = 0.4;
        track.delayNode.connect(feedback); feedback.connect(track.delayNode);
        track.delayNode.connect(masterGain);
        track.gainNode.connect(masterGain); track.gainNode.connect(track.delayNode); 
        updateTrackFX(track);
    });
}

function updateTrackFX(track) {
    if(!track.gainNode) return;
    track.gainNode.gain.value = track.volume;
    track.delayNode.delayTime.value = track.echo > 0 ? (60 / tempo) * 0.75 : 0;
}

function playDrum(type, pitch, time) {
    if (type === 'kick') {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.connect(gain).connect(masterGain);
        osc.frequency.setValueAtTime(150 * pitch, time); osc.frequency.exponentialRampToValueAtTime(0.001, time + 0.5);
        gain.gain.setValueAtTime(1, time); gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
        osc.start(time); osc.stop(time + 0.5);
    } else if (type === 'snare') {
        const noise = audioCtx.createBufferSource(), filter = audioCtx.createBiquadFilter(), gain = audioCtx.createGain();
        noise.buffer = noiseBuffer; filter.type = 'highpass'; filter.frequency.value = 1000 * pitch;
        gain.gain.setValueAtTime(1, time); gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
        noise.connect(filter).connect(gain).connect(masterGain); noise.start(time);
        noise.stop(time + 0.2);
        const osc = audioCtx.createOscillator(), oGain = audioCtx.createGain();
        osc.type = 'triangle'; osc.connect(oGain).connect(masterGain);
        osc.frequency.setValueAtTime(250 * pitch, time); oGain.gain.setValueAtTime(0.7, time);
        oGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
        osc.start(time); osc.stop(time + 0.2);
    } else if (type === 'hihat') {
        const noise = audioCtx.createBufferSource(), filter = audioCtx.createBiquadFilter(), gain = audioCtx.createGain();
        noise.buffer = noiseBuffer; filter.type = 'highpass'; filter.frequency.value = 7000 * pitch;
        gain.gain.setValueAtTime(0.5, time); gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
        noise.connect(filter).connect(gain).connect(masterGain); noise.start(time);
        noise.stop(time + 0.05);
    }
}

function getSecondsPerStep() { 
    return (60.0 / tempo) * 0.25;
}

function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + 0.1) {
        drumTracks.forEach(t => { if (t.pattern[currentStep]) playDrum(t.type, t.pitch, nextNoteTime); });
        nextNoteTime += getSecondsPerStep();
        currentStep++;
        
        if (currentStep >= STEPS) {
            currentStep = 0;
            loopStartTime = nextNoteTime;
            
            if(!isRecording) {
                stopAllVocals();
                audioClips.forEach(clip => {
                    const track = vocalTracks.find(t => t.id === clip.trackId);
                    if (!track) return;
                    const source = audioCtx.createBufferSource();
                    source.buffer = clip.buffer;    
                    source.playbackRate.value = track.pitch;
                    source.connect(track.gainNode);
                    source.start(loopStartTime + (clip.startStep * getSecondsPerStep()));
                    clip.sourceNode = source;               
                });
            }
        }
    }
    
    if (isPlaying) {
        const loopDuration = STEPS * getSecondsPerStep();
        const pxPos = ((audioCtx.currentTime - loopStartTime) % loopDuration) / loopDuration * (STEPS * STEP_WIDTH_PX);
        const transformStr = `translateX(${pxPos}px)`;
        if(playheadDrums) playheadDrums.style.transform = transformStr;
        if(playheadVocals) playheadVocals.style.transform = transformStr;
    }
    timerID = window.setTimeout(scheduler, 25.0);
}

function stopAllVocals() {
     audioClips.forEach(c => {
         if(c.sourceNode) {
             try{ c.sourceNode.stop(); } catch(e){}
             c.sourceNode = null;
         }
    });
}

document.getElementById('playBtn').addEventListener('click', (e) => {
    initAudio(); isPlaying = !isPlaying;
    if (isPlaying) {
        currentStep = STEPS; nextNoteTime = audioCtx.currentTime + 0.05; 
        if(playheadDrums) playheadDrums.style.display = 'block'; 
        if(playheadVocals) playheadVocals.style.display = 'block'; 
        scheduler();
        e.target.innerText = "⏸ Stop Demo"; e.target.style.backgroundColor = 'var(--danger-color)';
    } else {
        window.clearTimeout(timerID); stopAllVocals();      
        if(playheadDrums) playheadDrums.style.display = 'none'; 
        if(playheadVocals) playheadVocals.style.display = 'none';
        e.target.innerText = "▶ Play Demo"; e.target.style.backgroundColor = 'var(--primary-color)';
    }
});

function renderDrums() {
    if (!drumContainer) return;
    drumContainer.innerHTML = '';
    drumTracks.forEach(track => {
        const row = document.createElement('div'); row.className = 'layout-row';
        
        const header = document.createElement('div'); header.className = 'row-header';
        header.innerHTML = `<div class="track-name">${track.type}</div>
                            <div class="track-controls"><span class="control-label">Pitch</span>                  
                            <input type="range" class="mini-slider" min="0.5" max="2" step="0.1" value="${track.pitch}" oninput="updateDrumPitch('${track.id}', this.value)"></div>`;
        
        const grid = document.createElement('div'); grid.className = 'row-content drum-grid';
        for (let i = 0; i < STEPS; i++) {
            const cell = document.createElement('div');
            cell.className = `cell ${track.pattern[i] ? 'active' : ''}`;        
            cell.dataset.type = track.type;
            cell.onclick = () => { track.pattern[i] = !track.pattern[i]; cell.classList.toggle('active'); };
            grid.appendChild(cell);
        }
        row.appendChild(header); row.appendChild(grid); drumContainer.appendChild(row);
    });
}

window.updateDrumPitch = (id, val) => { 
    drumTracks.find(t => t.id === id).pitch = parseFloat(val);
};

function renderVocals() {
    if (!vocalContainer) return;
    vocalContainer.innerHTML = '';
    vocalTracks.forEach((track, index) => {
        const row = document.createElement('div'); row.className = 'layout-row';
        
        const header = document.createElement('div'); header.className = 'row-header';
        header.innerHTML = `
            <div class="track-name">
                Vox ${index + 1}
                <button class="rec-btn ${isRecording && activeRecTrack === track.id ? 'recording' : ''}" onclick="toggleRecord('${track.id}')">
                    ${isRecording && activeRecTrack === track.id ? '⏹' : '🔴'}
                </button>
            </div>
            <div class="track-controls"><span class="control-label">Vol</span><input type="range" class="mini-slider" min="0" max="2" step="0.1" value="${track.volume}" onchange="updateVoxFX('${track.id}', 'vol', this.value)"></div>
            <div class="track-controls"><span class="control-label">Pitch</span><input type="range" class="mini-slider" min="0.5" max="1.5" step="0.1" value="${track.pitch}" onchange="updateVoxFX('${track.id}', 'pitch', this.value)"></div>
            <div class="track-controls"><span class="control-label">Echo</span><input type="range" class="mini-slider" min="0" max="1" step="0.1" value="${track.echo}" onchange="updateVoxFX('${track.id}', 'echo', this.value)"></div>
        `;
        const trackTimeline = document.createElement('div'); trackTimeline.className = 'row-content timeline-track'; trackTimeline.id = `timeline-${track.id}`;
        row.appendChild(header); row.appendChild(trackTimeline); vocalContainer.appendChild(row);
    });

    audioClips.forEach(clip => {
        const trackEl = document.getElementById(`timeline-${clip.trackId}`);
        if (!trackEl) return;
        const clipEl = document.createElement('div'); clipEl.className = 'audio-clip'; clipEl.id = clip.id;
        const widthPx = (clip.buffer.duration / (STEPS * getSecondsPerStep())) * (STEPS * STEP_WIDTH_PX);
        clipEl.style.left = `${clip.startStep * STEP_WIDTH_PX}px`;
        clipEl.style.width = `${Math.max(20, widthPx)}px`;
        
        clipEl.appendChild(generateWaveformCanvas(clip.buffer));  
        clipEl.addEventListener('mousedown', handleClipDragStart);
        clipEl.addEventListener('dblclick', (e) => handleClipSplit(e, clip));
        trackEl.appendChild(clipEl);
    });
}

function generateWaveformCanvas(buffer) {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 50;
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.pointerEvents = 'none';
    const ctx = canvas.getContext('2d'), data = buffer.getChannelData(0), amp = canvas.height / 2;
    const step = Math.ceil(data.length / canvas.width);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    
    for (let i = 0; i < canvas.width; i++) {
        let min = 1.0, max = -1.0;
        for (let j = 0; j < step; j++) { 
            const d = data[(i * step) + j]; 
            if(d<min) min=d;
            if(d>max) max=d; 
        }
        ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
    return canvas;
}

window.updateVoxFX = (id, param, val) => {
    const track = vocalTracks.find(t => t.id === id);
    val = parseFloat(val);
    if (param === 'vol') track.volume = val; 
    if (param === 'pitch') track.pitch = val;
    if (param === 'echo') track.echo = val;
    updateTrackFX(track);
};

document.getElementById('addVocalTrackBtn').onclick = () => { 
    vocalTracks.push({ id: `vt-${vocalTracks.length}`, volume: 1.0, pitch: 1.0, echo: 0, gainNode: null, delayNode: null });
    initVocalRouting(); renderVocals(); 
};

window.toggleRecord = async (trackId) => {
    if (isRecording) {
        if (activeRecTrack !== trackId) return;
        mediaRec.stop(); isRecording = false; activeRecTrack = null; renderVocals(); return;
    }
    initAudio();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRec = new MediaRecorder(stream); audioChunks = [];
        mediaRec.ondataavailable = ev => { if (ev.data.size > 0) audioChunks.push(ev.data); };
        mediaRec.onstop = async () => {
            const audioBuf = await audioCtx.decodeAudioData(await (new Blob(audioChunks)).arrayBuffer());
            audioClips.push({ id: `clip-${clipIdCounter++}`, buffer: audioBuf, trackId: trackId, startStep: 0, sourceNode: null });
            stream.getTracks().forEach(t => t.stop()); renderVocals();
        };
        if (!isPlaying) document.getElementById('playBtn').click();
        setTimeout(() => {
            mediaRec.start(); isRecording = true; activeRecTrack = trackId; renderVocals();
        }, 100);
    } catch (err) { 
        alert("Microphone access is required to record vocals. " + err);
    }
};

let isShiftDown = false;
window.addEventListener('keydown', e => { if(e.key === 'Shift') isShiftDown = true; });
window.addEventListener('keyup', e => { if(e.key === 'Shift') isShiftDown = false; });

function handleClipDragStart(e) {
    e.preventDefault();
    let clip = audioClips.find(c => c.id === e.target.closest('.audio-clip').id);
    
    if (isShiftDown) {
        const newClip = { id: `clip-${clipIdCounter++}`, buffer: clip.buffer, trackId: clip.trackId, startStep: clip.startStep, sourceNode: null };
        audioClips.push(newClip); clip = newClip; renderVocals();
    }
    const clipEl = document.getElementById(clip.id);
    
    const onMouseMove = (moveEvent) => {
        let targetTrackId = clip.trackId, foundTrackEl = null;
        document.querySelectorAll('.timeline-track').forEach(tEl => {
            const r = tEl.getBoundingClientRect();
            if (moveEvent.clientY >= r.top && moveEvent.clientY <= r.bottom) { 
                targetTrackId = tEl.id.replace('timeline-', ''); 
                foundTrackEl = tEl; 
            }
        });
        if (foundTrackEl) {
            const r = foundTrackEl.getBoundingClientRect();
            let xPos = Math.max(0, moveEvent.clientX - r.left);
            xPos = Math.round(xPos / (STEP_WIDTH_PX/2)) * (STEP_WIDTH_PX/2); 
            clip.trackId = targetTrackId;
            clip.startStep = xPos / STEP_WIDTH_PX;
            clipEl.style.left = `${xPos}px`;
            if(clipEl.parentElement !== foundTrackEl) foundTrackEl.appendChild(clipEl);
            clipEl.style.opacity = '1';
        } else { 
            clipEl.style.opacity = '0.2'; 
        }
    };
    
    const onMouseUp = (upEvent) => {
        window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp);
        const r = vocalContainer.getBoundingClientRect();
        if (upEvent.clientY < r.top - 50 || upEvent.clientY > r.bottom + 50) audioClips = audioClips.filter(c => c.id !== clip.id);
        renderVocals();
    };
    window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp);
}

async function handleClipSplit(e, clip) {
    e.preventDefault();
    const r = e.target.closest('.audio-clip').getBoundingClientRect(), clickRatio = (e.clientX - r.left) / r.width;
    if(clickRatio <= 0.1 || clickRatio >= 0.9) return;
    
    const splitTime = Math.floor(clip.buffer.length * clickRatio);
    const buf1 = audioCtx.createBuffer(1, splitTime, audioCtx.sampleRate), buf2 = audioCtx.createBuffer(1, clip.buffer.length - splitTime, audioCtx.sampleRate);
    buf1.copyToChannel(clip.buffer.getChannelData(0).slice(0, splitTime), 0); 
    buf2.copyToChannel(clip.buffer.getChannelData(0).slice(splitTime), 0);
    
    clip.buffer = buf1;
    audioClips.push({ id: `clip-${clipIdCounter++}`, buffer: buf2, trackId: clip.trackId, startStep: clip.startStep + (clickRatio * (clip.buffer.duration / getSecondsPerStep())), sourceNode: null });
    renderVocals();
}

document.getElementById('downloadBtn').onclick = () => {
    initAudio(); if (isPlaying) document.getElementById('playBtn').click();
    const btn = document.getElementById('downloadBtn'), mixRec = new MediaRecorder(mixDest.stream), chunks = [];
    mixRec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mixRec.onstop = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' })); 
        a.download = `BeatBox_Mix.webm`; 
        a.click();
        btn.innerText = "⬇ Download Mix"; btn.style.backgroundColor = 'var(--success-color)';
    };
    mixRec.start(); btn.innerText = "🔴 Bouncing... Click to stop"; btn.style.backgroundColor = 'var(--danger-color)';
    setTimeout(() => document.getElementById('playBtn').click(), 100);
};

document.getElementById('bpmSlider').oninput = (e) => { 
    tempo = e.target.value; 
    document.getElementById('bpmDisplay').innerText = tempo; 
    renderVocals(); 
};

renderDrums(); 
renderVocals();
