let wasm;
let currentColorScheme = 0;
let lastSpectrumData = null;

const colorSchemes = [
    {
        name: '蓝青渐变',
        getColor: (i, barCount) => {
            const hue = (i / barCount) * 120 + 180;
            return { start: `hsla(${hue}, 100%, 60%, 1)`, end: `hsla(${hue}, 100%, 30%, 0.5)` };
        }
    },
    {
        name: '青绿渐变',
        getColor: (i, barCount) => {
            const hue = (i / barCount) * 60 + 120;
            return { start: `hsla(${hue}, 100%, 50%, 1)`, end: `hsla(${hue}, 100%, 30%, 0.5)` };
        }
    },
    {
        name: '绿黄渐变',
        getColor: (i, barCount) => {
            const hue = (i / barCount) * 60 + 60;
            return { start: `hsla(${hue}, 100%, 55%, 1)`, end: `hsla(${hue}, 100%, 35%, 0.5)` };
        }
    },
    {
        name: '橙红渐变',
        getColor: (i, barCount) => {
            const hue = (i / barCount) * 30 + 15;
            return { start: `hsla(${hue}, 100%, 55%, 1)`, end: `hsla(${hue}, 100%, 35%, 0.5)` };
        }
    },
    {
        name: '紫粉渐变',
        getColor: (i, barCount) => {
            const hue = (i / barCount) * 60 + 280;
            return { start: `hsla(${hue}, 100%, 60%, 1)`, end: `hsla(${hue}, 100%, 35%, 0.5)` };
        }
    },
    {
        name: '彩虹渐变',
        getColor: (i, barCount) => {
            const hue = (i / barCount) * 360;
            return { start: `hsla(${hue}, 100%, 60%, 1)`, end: `hsla(${hue}, 100%, 40%, 0.6)` };
        }
    }
];

async function init() {
    wasm = await import('./pkg/audio_fft_wasm.js');
    console.log('Wasm模块加载成功!');
}

function parseWav(buffer) {
    const view = new DataView(buffer);
    
    const riff = String.fromCharCode(
        view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
    );
    if (riff !== 'RIFF') {
        throw new Error('不是有效的WAV文件');
    }
    
    const wave = String.fromCharCode(
        view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)
    );
    if (wave !== 'WAVE') {
        throw new Error('不是有效的WAV文件');
    }
    
    let offset = 12;
    let audioFormat, numChannels, sampleRate, bitsPerSample;
    let dataOffset, dataSize;
    
    while (offset < buffer.byteLength) {
        const chunkId = String.fromCharCode(
            view.getUint8(offset), view.getUint8(offset + 1),
            view.getUint8(offset + 2), view.getUint8(offset + 3)
        );
        const chunkSize = view.getUint32(offset + 4, true);
        
        if (chunkId === 'fmt ') {
            audioFormat = view.getUint16(offset + 8, true);
            numChannels = view.getUint16(offset + 10, true);
            sampleRate = view.getUint32(offset + 12, true);
            bitsPerSample = view.getUint16(offset + 22, true);
        } else if (chunkId === 'data') {
            dataOffset = offset + 8;
            dataSize = chunkSize;
            break;
        }
        
        offset += 8 + chunkSize;
    }
    
    if (audioFormat !== 1) {
        throw new Error('仅支持PCM格式的WAV文件');
    }
    
    const bytesPerSample = bitsPerSample / 8;
    const maxSamples = Math.floor((buffer.byteLength - dataOffset) / bytesPerSample);
    const samples = Math.min(Math.floor(dataSize / bytesPerSample), maxSamples);
    
    const pcmData = new Float32Array(samples);
    
    for (let i = 0; i < samples; i++) {
        const sampleOffset = dataOffset + i * bytesPerSample;
        if (sampleOffset + bytesPerSample > buffer.byteLength) {
            pcmData[i] = 0;
            continue;
        }
        
        if (bitsPerSample === 16) {
            const value = view.getInt16(sampleOffset, true);
            pcmData[i] = value / 32768.0;
        } else if (bitsPerSample === 8) {
            const value = view.getUint8(sampleOffset);
            pcmData[i] = (value - 128) / 128.0;
        } else if (bitsPerSample === 24) {
            const value = view.getInt8(sampleOffset + 2) << 16 |
                          view.getUint8(sampleOffset + 1) << 8 |
                          view.getUint8(sampleOffset);
            pcmData[i] = value / 8388608.0;
        } else {
            throw new Error(`不支持的位深度: ${bitsPerSample}`);
        }
    }
    
    return {
        numChannels,
        sampleRate,
        bitsPerSample,
        pcmData
    };
}

function getMonoChannel(pcmData, numChannels) {
    if (numChannels === 1) {
        return pcmData;
    }
    
    const totalSamples = Math.floor(pcmData.length / numChannels);
    const monoData = new Float32Array(totalSamples);
    
    for (let i = 0; i < totalSamples; i++) {
        const idx = i * numChannels;
        if (idx < pcmData.length) {
            monoData[i] = pcmData[idx];
        } else {
            monoData[i] = 0;
        }
    }
    return monoData;
}

function applyWindow(data) {
    const result = new Float32Array(data.length);
    if (data.length <= 1) {
        return data.slice();
    }
    for (let i = 0; i < data.length; i++) {
        const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (data.length - 1)));
        result[i] = data[i] * window;
    }
    return result;
}

function normalizeSpectrum(spectrum) {
    let max = 0;
    for (const val of spectrum) {
        if (val > max) max = val;
    }
    if (max === 0) return spectrum;
    
    const result = new Float32Array(spectrum.length);
    for (let i = 0; i < spectrum.length; i++) {
        result[i] = spectrum[i] / max;
    }
    return result;
}

function drawSpectrum(canvas, spectrum, schemeIndex = 0) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    const height = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    
    ctx.clearRect(0, 0, width, height);
    
    if (!spectrum || spectrum.length === 0) return;
    
    const barCount = Math.min(spectrum.length, 200);
    const barWidth = width / barCount - 2;
    const scheme = colorSchemes[schemeIndex] || colorSchemes[0];
    
    for (let i = 0; i < barCount; i++) {
        const spectrumIndex = Math.floor(i * spectrum.length / barCount);
        const value = spectrum[spectrumIndex] || 0;
        const barHeight = Math.max(value * height * 0.9, 1);
        
        const colors = scheme.getColor(i, barCount);
        const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, colors.start);
        gradient.addColorStop(1, colors.end);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(
            i * (barWidth + 2),
            height - barHeight,
            barWidth,
            barHeight
        );
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const fileInput = document.getElementById('wavFile');
    const fileInfo = document.getElementById('fileInfo');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const status = document.getElementById('status');
    const canvas = document.getElementById('spectrumCanvas');
    
    let audioData = null;
    
    try {
        await init();
        status.textContent = 'Wasm模块加载成功，请选择WAV文件';
        status.className = 'status success';
    } catch (e) {
        status.textContent = 'Wasm模块加载失败，请先运行构建命令';
        status.className = 'status error';
        console.error(e);
    }
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
            fileInfo.textContent = '未选择文件';
            analyzeBtn.disabled = true;
            return;
        }
        
        fileInfo.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        analyzeBtn.disabled = false;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                audioData = parseWav(event.target.result);
                status.textContent = `文件解析成功: ${audioData.numChannels}声道, ${audioData.sampleRate}Hz, ${audioData.bitsPerSample}位`;
                status.className = 'status success';
            } catch (err) {
                status.textContent = err.message;
                status.className = 'status error';
                audioData = null;
                analyzeBtn.disabled = true;
            }
        };
        reader.readAsArrayBuffer(file);
    });
    
    analyzeBtn.addEventListener('click', () => {
        if (!audioData || !wasm) {
            status.textContent = 'Wasm模块未加载或无音频数据';
            status.className = 'status error';
            return;
        }
        
        try {
            console.log('音频信息:', {
                numChannels: audioData.numChannels,
                sampleRate: audioData.sampleRate,
                pcmLength: audioData.pcmData.length,
                bitsPerSample: audioData.bitsPerSample
            });
            
            const monoData = getMonoChannel(audioData.pcmData, audioData.numChannels);
            console.log('单声道数据长度:', monoData.length);
            
            const fftSize = Math.min(4096, wasm.next_power_of_two(monoData.length));
            console.log('FFT大小:', fftSize);
            
            const segment = monoData.slice(0, fftSize);
            console.log('分析段长度:', segment.length);
            
            if (segment.length === 0) {
                throw new Error('没有可分析的音频数据');
            }
            
            const windowed = applyWindow(segment);
            const spectrum = wasm.compute_fft(windowed);
            console.log('频谱数据长度:', spectrum.length);
            
            const normalized = normalizeSpectrum(spectrum);
            lastSpectrumData = normalized;
            drawSpectrum(canvas, normalized, currentColorScheme);
            
            const channelText = audioData.numChannels === 1 ? '单声道' : `${audioData.numChannels}声道(取左声道)`;
            status.textContent = `频谱分析完成 - ${channelText} - FFT大小: ${fftSize}, 频谱点数: ${normalized.length}`;
            status.className = 'status success';
        } catch (e) {
            status.textContent = '分析失败: ' + e.message;
            status.className = 'status error';
            console.error('分析错误:', e);
        }
    });
    
    const colorSlider = document.getElementById('colorScheme');
    const schemeName = document.getElementById('schemeName');
    
    colorSlider.addEventListener('input', (e) => {
        currentColorScheme = parseInt(e.target.value);
        schemeName.textContent = colorSchemes[currentColorScheme].name;
        
        if (lastSpectrumData) {
            drawSpectrum(canvas, lastSpectrumData, currentColorScheme);
        }
    });
});
