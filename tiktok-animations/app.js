/* ============================================
   TikTok Text Animations — App Engine (v2)
   ============================================ */

const ANIMATIONS = [
    { id: 'typewriter',      name: 'Typewriter',      icon: '⌨️', type: 'special', tag: 'TYPE' },
    { id: 'fade-in',         name: 'Fade In',         icon: '🌟', type: 'css',     tag: 'FADE' },
    { id: 'fade-in-up',      name: 'Fade In Up',      icon: '⬆️', type: 'css',     tag: 'FADE' },
    { id: 'fade-in-down',    name: 'Fade In Down',    icon: '⬇️', type: 'css',     tag: 'FADE' },
    { id: 'slide-left',      name: 'Slide Left',      icon: '◀️', type: 'css',     tag: 'MOVE' },
    { id: 'slide-right',     name: 'Slide Right',     icon: '▶️', type: 'css',     tag: 'MOVE' },
    { id: 'bounce-in',       name: 'Bounce In',       icon: '🏀', type: 'css',     tag: 'MOVE' },
    { id: 'scale-up',        name: 'Scale Up',        icon: '🔍', type: 'css',     tag: 'SCALE' },
    { id: 'scale-down',      name: 'Scale Down',      icon: '🔎', type: 'css',     tag: 'SCALE' },
    { id: 'glitch',          name: 'Glitch',          icon: '⚡', type: 'special', tag: 'FX' },
    { id: 'neon',            name: 'Neon Glow',       icon: '💡', type: 'css',     tag: 'FX' },
    { id: 'wave',            name: 'Wave',            icon: '🌊', type: 'chars',   tag: 'CHAR' },
    { id: 'rotate-in',       name: 'Rotate In',       icon: '🔄', type: 'css',     tag: '3D' },
    { id: 'flip',            name: 'Flip',            icon: '🃏', type: 'css',     tag: '3D' },
    { id: 'blur-in',         name: 'Blur In',         icon: '🌫️', type: 'css',    tag: 'FADE' },
    { id: 'shake',           name: 'Shake',           icon: '📳', type: 'css',     tag: 'FX' },
    { id: 'rainbow',         name: 'Rainbow',         icon: '🌈', type: 'css',     tag: 'COLOR' },
    { id: 'word-by-word',    name: 'Word by Word',    icon: '📝', type: 'words',   tag: 'WORD' },
    { id: 'letter-spacing',  name: 'Letter Space',    icon: '↔️', type: 'css',     tag: 'TYPE' },
    { id: 'zoom-pulse',      name: 'Zoom Pulse',      icon: '💓', type: 'css',     tag: 'SCALE' },
    { id: 'shadow-pop',      name: 'Shadow Pop',      icon: '🎭', type: 'css',     tag: 'FX' },
    { id: 'gradient-shift',  name: 'Gradient Shift',  icon: '🎨', type: 'css',     tag: 'COLOR' },
    { id: 'dissolve',        name: 'Dissolve',        icon: '✨', type: 'chars',   tag: 'CHAR' },
    { id: 'matrix',          name: 'Matrix Rain',     icon: '🟢', type: 'chars',   tag: 'CHAR' },
    { id: '3d-rotate',       name: '3D Rotate',       icon: '🎲', type: 'css',     tag: '3D' },
];

class AnimationEngine {
    constructor() {
        this.currentAnimation = 'typewriter';
        this.speed = 1;
        this.duration = 1;
        this.fontSize = 48;
        this.textColor = '#ffffff';
        this.bgColor = '#0a0a0f';
        this.fontFamily = "'Outfit', sans-serif";
        this.fontWeight = '700';
        this.loop = 'infinite';
        this.isPlaying = true;
        this.text = 'Hello TikTok!';

        this.initElements();
        this.buildAnimationList();
        this.bindEvents();
        this.initVoice();
        this.applyAnimation();
    }

    initElements() {
        this.el = {
            textInput:     document.getElementById('textInput'),
            animGrid:      document.getElementById('animationGrid'),
            speedSlider:   document.getElementById('speedSlider'),
            speedValue:    document.getElementById('speedValue'),
            durationSlider:document.getElementById('durationSlider'),
            durationValue: document.getElementById('durationValue'),
            fontSizeSlider:document.getElementById('fontSizeSlider'),
            fontSizeValue: document.getElementById('fontSizeValue'),
            fontFamily:    document.getElementById('fontFamily'),
            fontWeight:    document.getElementById('fontWeight'),
            textColor:     document.getElementById('textColor'),
            bgColor:       document.getElementById('bgColor'),
            animText:      document.getElementById('animationText'),
            previewArea:   document.getElementById('previewArea'),
            currentAnimName: document.getElementById('currentAnimName'),
            currentSpeed:  document.getElementById('currentSpeed'),
            playBtn:       document.getElementById('playBtn'),
            pauseBtn:      document.getElementById('pauseBtn'),
            resetBtn:      document.getElementById('resetBtn'),
            copyCSS:       document.getElementById('copyCSS'),
            fullscreenBtn: document.getElementById('fullscreenBtn'),
            toast:         document.getElementById('toast'),
            voiceBtn:      document.getElementById('voiceBtn'),
            voiceStatus:   document.getElementById('voiceStatus'),
            voiceStatusText: document.getElementById('voiceStatusText'),
        };
    }

    /* ── Animation List (full rows) ── */
    buildAnimationList() {
        this.el.animGrid.innerHTML = ANIMATIONS.map(a => `
            <div class="anim-item${a.id === this.currentAnimation ? ' active' : ''}" data-anim="${a.id}">
                <span class="icon">${a.icon}</span>
                <span class="name">${a.name}</span>
                <span class="mini">${a.tag}</span>
            </div>
        `).join('');
    }

    /* ── Events ── */
    bindEvents() {
        // Text
        this.el.textInput.addEventListener('input', e => {
            this.text = e.target.value || 'Hello TikTok!';
            this.applyAnimation();
        });

        // Animation select
        this.el.animGrid.addEventListener('click', e => {
            const item = e.target.closest('.anim-item');
            if (!item) return;
            this.el.animGrid.querySelectorAll('.anim-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            this.currentAnimation = item.dataset.anim;
            this.applyAnimation();
        });

        // Speed
        this.el.speedSlider.addEventListener('input', e => {
            this.speed = parseFloat(e.target.value);
            this.el.speedValue.textContent = `${this.speed.toFixed(1)}x`;
            this.el.currentSpeed.textContent = `${this.speed.toFixed(1)}x`;
            this.updatePresets('.preset[data-speed]', this.speed, 'speed');
            this.updateSpeed();
        });

        document.querySelectorAll('.preset[data-speed]').forEach(btn => {
            btn.addEventListener('click', () => {
                const s = parseFloat(btn.dataset.speed);
                this.speed = s;
                this.el.speedSlider.value = s;
                this.el.speedValue.textContent = `${s.toFixed(1)}x`;
                this.el.currentSpeed.textContent = `${s.toFixed(1)}x`;
                this.updatePresets('.preset[data-speed]', s, 'speed');
                this.updateSpeed();
            });
        });

        // Duration
        this.el.durationSlider.addEventListener('input', e => {
            this.duration = parseFloat(e.target.value);
            this.el.durationValue.textContent = `${this.duration.toFixed(1)}s`;
            this.applyAnimation();
        });

        // Font size
        this.el.fontSizeSlider.addEventListener('input', e => {
            this.fontSize = parseInt(e.target.value);
            this.el.fontSizeValue.textContent = `${this.fontSize}px`;
            this.el.animText.style.fontSize = `${this.fontSize}px`;
        });

        // Font family
        this.el.fontFamily.addEventListener('change', e => {
            this.fontFamily = e.target.value;
            this.el.animText.style.fontFamily = this.fontFamily;
        });

        // Weight
        this.el.fontWeight.addEventListener('change', e => {
            this.fontWeight = e.target.value;
            this.el.animText.style.fontWeight = this.fontWeight;
        });

        // Colors
        this.el.textColor.addEventListener('input', e => {
            this.textColor = e.target.value;
            this.el.animText.style.color = this.textColor;
        });
        this.el.bgColor.addEventListener('input', e => {
            this.bgColor = e.target.value;
            this.el.previewArea.style.background = this.bgColor;
        });

        // Loop
        document.querySelectorAll('.preset[data-loop]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.preset[data-loop]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.loop = btn.dataset.loop;
                this.applyAnimation();
            });
        });

        // Playback
        this.el.playBtn.addEventListener('click', () => this.play());
        this.el.pauseBtn.addEventListener('click', () => this.pause());
        this.el.resetBtn.addEventListener('click', () => this.applyAnimation());

        // Copy CSS
        this.el.copyCSS.addEventListener('click', () => this.copyCSS());

        // Fullscreen
        this.el.fullscreenBtn.addEventListener('click', () => {
            document.querySelector('.app').classList.toggle('fullscreen');
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                document.querySelector('.app').classList.remove('fullscreen');
                this.stopVoice();
            }
        });

        // Voice
        this.el.voiceBtn.addEventListener('click', () => {
            if (!this.recognition) {
                this.showToast('❌ Browser không hỗ trợ Speech');
                return;
            }
            this.isRecording ? this.stopVoice() : this.startVoice();
        });

        // Languages
        document.querySelectorAll('.lang').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.lang').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.voiceLang = btn.dataset.lang;
                if (this.recognition) this.recognition.lang = this.voiceLang;
                if (this.isRecording) {
                    this.recognition.stop();
                    setTimeout(() => { try { this.recognition.start(); } catch(e) {} }, 200);
                }
            });
        });
    }

    updatePresets(selector, value, attr) {
        document.querySelectorAll(selector).forEach(b => {
            b.classList.toggle('active', Math.abs(parseFloat(b.dataset[attr]) - value) < 0.05);
        });
    }

    /* ── Voice ── */
    initVoice() {
        this.voiceLang = 'vi-VN';
        this.isRecording = false;
        this.recognition = null;

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            this.el.voiceBtn.style.opacity = '.3';
            this.el.voiceBtn.style.cursor = 'not-allowed';
            return;
        }

        this.recognition = new SR();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.voiceLang;
        let final = '';

        this.recognition.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
                else interim = e.results[i][0].transcript;
            }
            const txt = (final + interim).trim();
            if (txt) {
                this.el.textInput.value = txt;
                this.text = txt;
                this.applyAnimation();
            }
        };

        this.recognition.onstart = () => {
            final = this.el.textInput.value ? this.el.textInput.value + ' ' : '';
            this.isRecording = true;
            this.el.voiceBtn.classList.add('recording');
            this.el.voiceStatus.classList.add('active');
            this.el.voiceStatusText.textContent = `🎙️ Listening (${this.voiceLang})…`;
        };

        this.recognition.onend = () => {
            if (this.isRecording) {
                try { this.recognition.start(); } catch(e) {}
            } else {
                this.el.voiceBtn.classList.remove('recording');
                this.el.voiceStatus.classList.remove('active');
            }
        };

        this.recognition.onerror = (e) => {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            this.stopVoice();
            this.showToast(`⚠️ ${e.error}`);
        };
    }

    startVoice() {
        if (!this.recognition) return;
        this.recognition.lang = this.voiceLang;
        try { this.recognition.start(); } catch(e) {}
    }

    stopVoice() {
        this.isRecording = false;
        if (this.recognition) this.recognition.stop();
        if (this.el.voiceBtn) this.el.voiceBtn.classList.remove('recording');
        if (this.el.voiceStatus) this.el.voiceStatus.classList.remove('active');
    }

    /* ── Apply Animation ── */
    applyAnimation() {
        const anim = ANIMATIONS.find(a => a.id === this.currentAnimation);
        if (!anim) return;
        this.el.currentAnimName.textContent = anim.name;

        const el = this.el.animText;
        el.className = 'animation-text';
        el.removeAttribute('data-text');
        el.style.fontSize = `${this.fontSize}px`;
        el.style.fontFamily = this.fontFamily;
        el.style.fontWeight = this.fontWeight;
        el.style.color = this.textColor;

        const dur = this.duration / this.speed;
        el.style.setProperty('--dur', `${dur}s`);
        el.style.animationIterationCount = this.loop;

        switch (anim.type) {
            case 'css':
                el.textContent = this.text;
                void el.offsetWidth;
                el.classList.add(`anim-${this.currentAnimation}`);
                el.style.animationIterationCount = this.loop;
                break;
            case 'special':
                if (this.currentAnimation === 'typewriter') {
                    el.textContent = this.text;
                    el.style.setProperty('--chars', this.text.length);
                    void el.offsetWidth;
                    el.classList.add('anim-typewriter');
                    el.style.animationIterationCount = this.loop;
                } else {
                    el.textContent = this.text;
                    el.setAttribute('data-text', this.text);
                    void el.offsetWidth;
                    el.classList.add('anim-glitch');
                }
                break;
            case 'chars':
                el.innerHTML = this.text.split('').map((c, i) =>
                    `<span class="char" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`
                ).join('');
                void el.offsetWidth;
                el.classList.add(`anim-${this.currentAnimation}`);
                break;
            case 'words':
                el.innerHTML = this.text.split(/\s+/).map((w, i) =>
                    `<span class="word" style="--i:${i}">${w}</span>`
                ).join('');
                void el.offsetWidth;
                el.classList.add(`anim-${this.currentAnimation}`);
                break;
        }
        this.isPlaying = true;
    }

    updateSpeed() {
        const dur = this.duration / this.speed;
        this.el.animText.style.setProperty('--dur', `${dur}s`);
        this.el.animText.querySelectorAll('.char,.word').forEach(c =>
            c.style.setProperty('--dur', `${dur}s`)
        );
    }

    play() {
        this.el.animText.style.animationPlayState = 'running';
        this.el.animText.querySelectorAll('.char,.word').forEach(c =>
            c.style.animationPlayState = 'running'
        );
    }

    pause() {
        this.el.animText.style.animationPlayState = 'paused';
        this.el.animText.querySelectorAll('.char,.word').forEach(c =>
            c.style.animationPlayState = 'paused'
        );
    }

    showToast(msg) {
        this.el.toast.textContent = msg;
        this.el.toast.classList.add('show');
        setTimeout(() => this.el.toast.classList.remove('show'), 2500);
    }

    copyCSS() {
        const a = ANIMATIONS.find(x => x.id === this.currentAnimation);
        const dur = (this.duration / this.speed).toFixed(2);
        let css = `/* ${a.name} */\n.text {\n  font-family: ${this.fontFamily};\n  font-size: ${this.fontSize}px;\n  font-weight: ${this.fontWeight};\n  color: ${this.textColor};\n  animation: ${a.id} ${dur}s ease-out`;
        if (this.loop === 'infinite') css += ' infinite';
        css += ';\n}\n';
        navigator.clipboard.writeText(css).then(() => this.showToast('✅ CSS copied!'));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new AnimationEngine();
});
