// Pad de firma propio (sin dependencias). Reemplaza a signature_pad: misma API
// mínima (isEmpty, clear, toDataURL, fromDataURL, on, off) para que la firma se
// capture y se guarde igual en cualquier WebView, sin depender de librerías externas.
(function () {
    class SignaturePad {
        constructor(canvas, opts) {
            opts = opts || {};
            this.canvas = canvas;
            this.bg = opts.backgroundColor || 'rgb(255, 255, 255)';
            this.pen = opts.penColor || 'rgb(0, 0, 0)';
            this.ancho = opts.dotSize || 2.6;
            this._vacio = true; this._dibujando = false; this._p = null; this._activo = false;
            this._d = (e) => this._inicio(e); this._m = (e) => this._mueve(e); this._u = (e) => this._fin(e);
            canvas.style.touchAction = 'none';
            this.on();
            this.clear();
        }
        on() {
            if (this._activo) return; this._activo = true;
            const c = this.canvas;
            c.addEventListener('pointerdown', this._d);
            c.addEventListener('pointermove', this._m);
            c.addEventListener('pointerup', this._u);
            c.addEventListener('pointercancel', this._u);
            c.addEventListener('pointerleave', this._u);
        }
        off() {
            this._activo = false;
            const c = this.canvas;
            c.removeEventListener('pointerdown', this._d);
            c.removeEventListener('pointermove', this._m);
            c.removeEventListener('pointerup', this._u);
            c.removeEventListener('pointercancel', this._u);
            c.removeEventListener('pointerleave', this._u);
        }
        _xy(e) {
            const r = this.canvas.getBoundingClientRect();
            return { x: (e.clientX - r.left) * (this.canvas.width / (r.width || 1)), y: (e.clientY - r.top) * (this.canvas.height / (r.height || 1)) };
        }
        _ctx() { const x = this.canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); return x; }
        _escala() { const r = this.canvas.getBoundingClientRect(); return this.canvas.width / (r.width || this.canvas.width || 1); }
        _inicio(e) {
            e.preventDefault();
            try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
            this._dibujando = true; this._p = this._xy(e);
            const x = this._ctx(), k = this._escala();
            x.fillStyle = this.pen; x.beginPath(); x.arc(this._p.x, this._p.y, this.ancho * k / 2, 0, Math.PI * 2); x.fill();
            this._vacio = false;
        }
        _mueve(e) {
            if (!this._dibujando) return;
            e.preventDefault();
            const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
            const x = this._ctx(), k = this._escala();
            x.strokeStyle = this.pen; x.lineWidth = this.ancho * k; x.lineCap = 'round'; x.lineJoin = 'round';
            for (const ev of evs) {
                const p = this._xy(ev);
                x.beginPath(); x.moveTo(this._p.x, this._p.y); x.lineTo(p.x, p.y); x.stroke();
                this._p = p; this._vacio = false;
            }
        }
        _fin(e) { this._dibujando = false; this._p = null; }
        clear() {
            const x = this._ctx();
            x.fillStyle = this.bg; x.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this._vacio = true;
        }
        isEmpty() { return this._vacio; }
        toDataURL(tipo) { return this.canvas.toDataURL(tipo || 'image/png'); }
        fromDataURL(url) {
            return new Promise((ok) => {
                const img = new Image();
                img.onload = () => {
                    const x = this._ctx(), W = this.canvas.width, H = this.canvas.height;
                    x.fillStyle = this.bg; x.fillRect(0, 0, W, H);
                    const k = Math.min(W / img.width, H / img.height);
                    const w = img.width * k, h = img.height * k;
                    x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
                    this._vacio = false; ok();
                };
                img.onerror = () => ok();
                img.src = url;
            });
        }
    }
    window.SignaturePad = SignaturePad;
})();
