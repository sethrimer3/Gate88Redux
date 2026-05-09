let installed = false;

export function installTextOutline(): void {
  if (installed) return;
  installed = true;
  const proto = CanvasRenderingContext2D.prototype;
  const originalFillText = proto.fillText;
  proto.fillText = function outlinedFillText(
    text: string,
    x: number,
    y: number,
    maxWidth?: number,
  ): void {
    this.save();
    const fill = this.fillStyle;
    const stroke = this.strokeStyle;
    const width = this.lineWidth;
    const composite = this.globalCompositeOperation;
    this.globalCompositeOperation = 'source-over';
    this.strokeStyle = 'rgba(255,255,255,0.72)';
    this.lineWidth = 1;
    this.lineJoin = 'round';
    if (maxWidth === undefined) {
      this.strokeText(text, x, y);
    } else {
      this.strokeText(text, x, y, maxWidth);
    }
    this.fillStyle = fill;
    this.strokeStyle = stroke;
    this.lineWidth = width;
    this.globalCompositeOperation = composite;
    this.restore();
    if (maxWidth === undefined) {
      originalFillText.call(this, text, x, y);
    } else {
      originalFillText.call(this, text, x, y, maxWidth);
    }
  };
}
