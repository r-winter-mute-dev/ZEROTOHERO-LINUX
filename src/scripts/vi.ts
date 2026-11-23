// Ein kleiner vi für den Simulator (Lernziel 103.8). Verhalten und Meldungen folgen vim.tiny, dem vi von Debian 12.
// Unterstützt: Normalmodus mit Zählern, Einfügemodus, Befehlszeile, Suche, Löschen, Kopieren, Einfügen, Rückgängig.

export type Modus = 'normal' | 'einfuegen' | 'befehl' | 'suche';
export interface ViOptionen {
  name: string;
  text: string;
  neu: boolean;
  schreibbar: boolean;                                                  // darf der Benutzer die Datei schreiben?
  speichern: (name: string, text: string, erzwingen: boolean) => string | null;   // Fehlermeldung oder null
}
export interface ViEnde { art: 'gespeichert' | 'verworfen' | 'unveraendert'; name: string; }

export class Vi {
  zeilen: string[];
  z = 0; s = 0;                 // Zeile und Spalte des Cursors
  modus: Modus = 'normal';
  eingabe = '';                 // Befehlszeile oder Suchmuster
  meldung = '';
  fehler = false;
  geaendert = false;
  geschrieben = false;
  nummern = false;
  oben = 0;                     // erste sichtbare Zeile
  private vorsatz = '';         // angefangene Befehle: Zahl, d, y, c, g, Z, r
  private register: { text: string[]; zeilenweise: boolean } = { text: [], zeilenweise: false };
  private undo: { zeilen: string[]; z: number; s: number }[] = [];
  private suche: { muster: string; vor: boolean } | null = null;
  private suchRichtung = true;
  ende: ViEnde | null = null;

  constructor(private o: ViOptionen) {
    this.zeilen = o.text ? o.text.replace(/\n$/, '').split('\n') : [''];
    const nl = o.text ? (o.text.match(/\n/g) ?? []).length : 0;
    this.meldung = o.neu ? `"${o.name}" [New]` : `"${o.name}"${o.schreibbar ? '' : ' [readonly]'} ${nl}L, ${new TextEncoder().encode(o.text).length}B`;
  }

  get text() { return this.zeilen.join('\n') + '\n'; }
  private zeile() { return this.zeilen[this.z] ?? ''; }
  private sichern() { this.undo.push({ zeilen: [...this.zeilen], z: this.z, s: this.s }); if (this.undo.length > 100) this.undo.shift(); }
  private klemmen(einfuegen = false) {
    this.z = Math.max(0, Math.min(this.zeilen.length - 1, this.z));
    const max = Math.max(0, this.zeile().length - (einfuegen ? 0 : 1));
    this.s = Math.max(0, Math.min(max, this.s));
  }
  private melden(t: string, f = false) { this.meldung = t; this.fehler = f; }

  /** Eine Taste verarbeiten. Namen wie bei KeyboardEvent.key: "a", "Escape", "Enter", "Backspace", "ArrowUp" … */
  taste(k: string): void {
    if (this.ende) return;
    if (this.modus === 'einfuegen') return this.einfuegen(k);
    if (this.modus === 'befehl' || this.modus === 'suche') return this.zeileTippen(k);
    this.normal(k);
  }

  private einfuegen(k: string) {
    const l = this.zeile();
    if (k === 'Escape') { this.modus = 'normal'; this.s = Math.max(0, this.s - 1); this.melden(''); this.klemmen(); return; }
    if (k === 'Enter') { this.zeilen.splice(this.z, 1, l.slice(0, this.s), l.slice(this.s)); this.z++; this.s = 0; this.geaendert = true; return; }
    if (k === 'Backspace') {
      if (this.s > 0) { this.zeilen[this.z] = l.slice(0, this.s - 1) + l.slice(this.s); this.s--; this.geaendert = true; }
      else if (this.z > 0) { const vor = this.zeilen[this.z - 1]; this.zeilen.splice(this.z - 1, 2, vor + l); this.z--; this.s = vor.length; this.geaendert = true; }
      return;
    }
    if (k === 'ArrowLeft') { this.s = Math.max(0, this.s - 1); return; }
    if (k === 'ArrowRight') { this.s = Math.min(l.length, this.s + 1); return; }
    if (k === 'ArrowUp') { this.z--; this.klemmen(true); return; }
    if (k === 'ArrowDown') { this.z++; this.klemmen(true); return; }
    if (k === 'Tab') k = '\t';
    if (k.length !== 1) return;
    this.zeilen[this.z] = l.slice(0, this.s) + k + l.slice(this.s); this.s++; this.geaendert = true;
  }

  private zeileTippen(k: string) {
    if (k === 'Escape') { this.modus = 'normal'; this.eingabe = ''; this.melden(''); return; }
    if (k === 'Backspace') { if (!this.eingabe) { this.modus = 'normal'; return; } this.eingabe = this.eingabe.slice(0, -1); return; }
    if (k === 'Enter') { const e = this.eingabe; const m = this.modus; this.modus = 'normal'; this.eingabe = ''; if (m === 'befehl') this.exBefehl(e); else { if (e) this.suche = { muster: e, vor: this.suchRichtung }; this.suchen(true, this.suche?.muster ?? e); } return; }
    if (k.length === 1) this.eingabe += k;
  }

  private bewegung(k: string, n: number): boolean {
    const l = this.zeile();
    switch (k) {
      case 'h': case 'ArrowLeft': case 'Backspace': this.s -= n; break;
      case 'l': case 'ArrowRight': case ' ': this.s += n; break;
      case 'j': case 'ArrowDown': case 'Enter': case '+': this.z += n; if (k === 'Enter' || k === '+') this.s = l.search(/\S|$/); break;
      case 'k': case 'ArrowUp': case '-': this.z -= n; break;
      case '0': case 'Home': this.s = 0; break;
      case '^': this.s = Math.max(0, l.search(/\S/)); break;
      case '$': case 'End': this.z += n - 1; this.klemmen(); this.s = this.zeile().length - 1; break;
      case 'w': for (let i = 0; i < n; i++) this.wortVor(); return true;
      case 'b': for (let i = 0; i < n; i++) this.wortZurueck(); return true;
      case 'G': this.z = this.vorsatzZahl ? n - 1 : this.zeilen.length - 1; this.s = this.zeile().search(/\S|$/); break;
      default: return false;
    }
    this.klemmen();
    return true;
  }
  private vorsatzZahl = false;
  private wortVor() {
    const l = this.zeile(); let i = this.s;
    const art = (c: string) => (/\s/.test(c) ? 0 : /\w|[äöüÄÖÜß]/.test(c) ? 1 : 2);
    if (i < l.length) { const a = art(l[i]); while (i < l.length && art(l[i]) === a && a !== 0) i++; }
    while (i < l.length && /\s/.test(l[i])) i++;
    if (i >= l.length && this.z < this.zeilen.length - 1) { this.z++; this.s = this.zeile().search(/\S|$/); return; }
    this.s = i;
  }
  private wortZurueck() {
    const l = this.zeile(); let i = this.s - 1;
    if (i < 0) { if (this.z > 0) { this.z--; this.s = Math.max(0, this.zeile().length - 1); } return; }
    while (i > 0 && /\s/.test(l[i])) i--;
    const w = /\w|[äöüÄÖÜß]/.test(l[i]);
    while (i > 0 && (/\w|[äöüÄÖÜß]/.test(l[i - 1]) === w) && !/\s/.test(l[i - 1])) i--;
    this.s = i;
  }

  private normal(k: string) {
    if (k === 'Escape') { this.vorsatz = ''; this.melden(''); return; }
    const v = this.vorsatz;
    // Zähler sammeln (0 allein ist „Zeilenanfang“)
    if (/^[0-9]$/.test(k) && !/[rf]$/.test(v) && (k !== '0' || /\d$/.test(v))) { this.vorsatz += k; return; }
    const zahl = v.match(/^(\d*)/)![1];
    const n = Math.max(1, Number(zahl || 1)); this.vorsatzZahl = !!zahl;
    const op = v.slice(zahl.length);
    this.vorsatz = '';
    if (this.meldung && !['n', 'N'].includes(k)) this.melden('');
    // Ersetzen eines Zeichens: r<x>
    if (op === 'r') { if (k.length === 1 && this.zeile().length) { this.sichern(); const l = this.zeile(); this.zeilen[this.z] = l.slice(0, this.s) + k + l.slice(this.s + 1); this.geaendert = true; } return; }
    if (op === 'Z') { if (k === 'Z') this.exBefehl('x'); else if (k === 'Q') this.exBefehl('q!'); return; }
    if (op === 'g') { if (k === 'g') { this.z = zahl ? n - 1 : 0; this.s = this.zeile().search(/\S|$/); this.klemmen(); } return; }
    if (op === 'd' || op === 'y' || op === 'c') {
      if (k === op) {               // dd, yy, cc: ganze Zeilen
        const teil = this.zeilen.slice(this.z, this.z + n);
        this.register = { text: teil, zeilenweise: true };
        if (op === 'y') { this.melden(n > 2 ? `${n} lines yanked` : ''); return; }
        this.sichern(); this.geaendert = true;
        if (op === 'c') { this.zeilen.splice(this.z, n, ''); this.s = 0; this.modus = 'einfuegen'; this.melden('-- INSERT --'); return; }
        this.zeilen.splice(this.z, n); if (!this.zeilen.length) this.zeilen = [''];
        this.klemmen(); this.s = this.zeile().search(/\S|$/);
        if (n > 2) this.melden(`${n} fewer lines`);
        return;
      }
      // Operator mit Bewegung innerhalb der Zeile: dw, d$, yw, cw, d0 …
      const vorher = { z: this.z, s: this.s };
      const l = this.zeile();
      if (k === 'w' && op === 'c') { let e = this.s; for (let i = 0; i < n; i++) { while (e < l.length && /\s/.test(l[e])) e++; while (e < l.length && !/\s/.test(l[e])) e++; } this.bereich(op, vorher.s, e); return; }
      if (!['w', 'b', '$', '0', '^', 'h', 'l', 'e'].includes(k)) return;
      if (k === 'e') { let e = this.s + 1; while (e < l.length && /\s/.test(l[e])) e++; while (e < l.length && !/\s/.test(l[e])) e++; this.bereich(op, vorher.s, e); return; }
      this.bewegung(k, n);
      let a = vorher.s; let e = this.z === vorher.z ? this.s : l.length; this.z = vorher.z;
      if (k === '$') e = l.length;
      if (e < a) [a, e] = [e, a];
      this.bereich(op, a, e);
      return;
    }
    if (this.bewegung(k, n)) return;
    const l = this.zeile();
    switch (k) {
      case 'i': this.einfuegenStart(); break;
      case 'a': if (l.length) this.s++; this.einfuegenStart(); break;
      case 'I': this.s = Math.max(0, l.search(/\S|$/)); this.einfuegenStart(); break;
      case 'A': this.s = l.length; this.einfuegenStart(); break;
      case 'o': this.sichern(); this.zeilen.splice(this.z + 1, 0, ''); this.z++; this.s = 0; this.geaendert = true; this.einfuegenStart(false); break;
      case 'O': this.sichern(); this.zeilen.splice(this.z, 0, ''); this.s = 0; this.geaendert = true; this.einfuegenStart(false); break;
      case 'x': if (l.length) { this.sichern(); const e = Math.min(l.length, this.s + n); this.register = { text: [l.slice(this.s, e)], zeilenweise: false }; this.zeilen[this.z] = l.slice(0, this.s) + l.slice(e); this.geaendert = true; this.klemmen(); } break;
      case 'X': if (this.s > 0) { this.sichern(); const a = Math.max(0, this.s - n); this.zeilen[this.z] = l.slice(0, a) + l.slice(this.s); this.s = a; this.geaendert = true; } break;
      case 'D': this.sichern(); this.register = { text: [l.slice(this.s)], zeilenweise: false }; this.zeilen[this.z] = l.slice(0, this.s); this.geaendert = true; this.klemmen(); break;
      case 'C': this.sichern(); this.zeilen[this.z] = l.slice(0, this.s); this.geaendert = true; this.einfuegenStart(false); break;
      case 'p': case 'P': this.einfuegenAusRegister(k === 'p', n); break;
      case 'u': {
        const u = this.undo.pop();
        if (!u) { this.melden('Already at oldest change'); break; }
        this.zeilen = u.zeilen; this.z = u.z; this.s = u.s; this.klemmen(); this.geaendert = true; this.melden('1 change; before #1');
        break;
      }
      case 'J': if (this.z < this.zeilen.length - 1) { this.sichern(); this.s = l.length; this.zeilen.splice(this.z, 2, l.replace(/\s+$/, '') + ' ' + this.zeilen[this.z + 1].replace(/^\s+/, '')); this.geaendert = true; } break;
      case ':': this.modus = 'befehl'; this.eingabe = ''; this.melden(''); break;
      case '/': this.modus = 'suche'; this.suchRichtung = true; this.eingabe = ''; this.melden(''); break;
      case '?': this.modus = 'suche'; this.suchRichtung = false; this.eingabe = ''; this.melden(''); break;
      case 'n': if (this.suche) this.suchen(this.suche.vor, this.suche.muster); else this.melden('E35: No previous regular expression', true); break;
      case 'N': if (this.suche) this.suchen(!this.suche.vor, this.suche.muster); else this.melden('E35: No previous regular expression', true); break;
      case 'd': case 'y': case 'c': case 'g': case 'Z': case 'r': this.vorsatz = (zahl || '') + k; break;
    }
  }

  private bereich(op: string, a: number, e: number) {
    const l = this.zeile();
    this.register = { text: [l.slice(a, e)], zeilenweise: false };
    if (op === 'y') { this.s = a; return; }
    this.sichern();
    this.zeilen[this.z] = l.slice(0, a) + l.slice(e); this.s = a; this.geaendert = true;
    if (op === 'c') { this.einfuegenStart(false); return; }
    this.klemmen();
  }
  private einfuegenStart(sichern = true) { if (sichern) this.sichern(); this.modus = 'einfuegen'; this.melden('-- INSERT --'); }
  private einfuegenAusRegister(nach: boolean, n: number) {
    const r = this.register; if (!r.text.length) { this.melden('E353: Nothing in register "', true); return; }
    this.sichern(); this.geaendert = true;
    if (r.zeilenweise) {
      const neu = Array.from({ length: n }, () => r.text).flat();
      const pos = nach ? this.z + 1 : this.z;
      this.zeilen.splice(pos, 0, ...neu); this.z = pos; this.s = this.zeile().search(/\S|$/);
      if (neu.length > 2) this.melden(`${neu.length} more lines`);
      return;
    }
    const t = r.text[0].repeat(n); const l = this.zeile(); const pos = nach && l.length ? this.s + 1 : this.s;
    this.zeilen[this.z] = l.slice(0, pos) + t + l.slice(pos); this.s = pos + t.length - 1;
  }

  private suchen(vor: boolean, muster: string) {
    let re: RegExp;
    try { re = new RegExp(muster.replace(/\\</g, '\\b').replace(/\\>/g, '\\b')); } catch { this.melden(`E486: Pattern not found: ${muster}`, true); return; }
    const anz = this.zeilen.length;
    for (let i = 0; i <= anz; i++) {
      const zi = vor ? (this.z + i) % anz : (this.z - i + anz * 2) % anz;
      const l = this.zeilen[zi];
      let treffer = -1;
      if (vor) { const start = i === 0 ? this.s + 1 : 0; const m = l.slice(start).search(re); if (m >= 0) treffer = start + m; }
      else { const grenze = i === 0 ? this.s : Infinity; for (let k = Math.min(l.length, grenze) - 1; k >= 0; k--) if (l.slice(k).search(re) === 0) { treffer = k; break; } }
      if (treffer >= 0) {
        const umbruch = vor ? zi < this.z || (zi === this.z && i > 0) : zi > this.z || (zi === this.z && i > 0);
        this.z = zi; this.s = treffer;
        this.melden(umbruch ? (vor ? 'search hit BOTTOM, continuing at TOP' : 'search hit TOP, continuing at BOTTOM') : (vor ? '/' : '?') + muster, umbruch);
        return;
      }
    }
    this.melden(`E486: Pattern not found: ${muster}`, true);
  }

  private exBefehl(e: string) {
    const b = e.trim();
    if (/^\d+$/.test(b)) { this.z = Number(b) - 1; this.klemmen(); this.s = this.zeile().search(/\S|$/); return; }
    if (b === '$') { this.z = this.zeilen.length - 1; this.s = 0; return; }
    if (b === 'set nu' || b === 'set number') { this.nummern = true; return; }
    if (b === 'set nonu' || b === 'set nonumber') { this.nummern = false; return; }
    const m = b.match(/^(w|write|wq|x|xit|q|quit|e|edit)(!?)(?:\s+(\S+))?$/);
    if (!m) { if (b) this.melden(`E492: Not an editor command: ${b}`, true); return; }
    const [, c0, bang, datei] = m; const c = c0[0] === 'e' ? 'e' : c0.startsWith('wq') ? 'wq' : c0[0] === 'x' ? 'x' : c0[0];
    const erzw = bang === '!';
    if (c === 'e') {
      if (!erzw && this.geaendert) { this.melden('E37: No write since last change (add ! to override)', true); return; }
      this.zeilen = this.o.text ? this.o.text.replace(/\n$/, '').split('\n') : ['']; this.z = 0; this.s = 0; this.geaendert = false; this.undo = [];
      this.melden(`"${this.o.name}" ${this.zeilen.length}L, ${new TextEncoder().encode(this.o.text).length}B`);
      return;
    }
    if (c === 'q') {
      if (this.geaendert && !erzw) { this.melden('E37: No write since last change (add ! to override)', true); return; }
      this.ende = { art: this.geschrieben ? 'gespeichert' : this.geaendert ? 'verworfen' : 'unveraendert', name: this.o.name };
      return;
    }
    // w, wq, x
    if (c === 'x' && !this.geaendert && !datei) { this.ende = { art: this.geschrieben ? 'gespeichert' : 'unveraendert', name: this.o.name }; return; }
    const ziel = datei ?? this.o.name;
    if (!datei && !this.o.schreibbar && !erzw) { this.melden("E45: 'readonly' option is set (add ! to override)", true); return; }
    const f = this.o.speichern(ziel, this.text, erzw);
    if (f) { this.melden(f, true); return; }
    const neu = this.o.neu && !datei;
    this.melden(`"${ziel}"${neu ? ' [New]' : ''} ${this.zeilen.length}L, ${new TextEncoder().encode(this.text).length}B written`);
    if (!datei) { this.geaendert = false; this.geschrieben = true; this.o.neu = false; this.o.text = this.text; }
    if (c === 'wq' || c === 'x') this.ende = { art: 'gespeichert', name: this.o.name };
  }

  /** Bildschirm als Zeilen: Text, ~ für leere Zeilen, unten Statuszeile. Cursor als [zeile, spalte] im Bild. */
  bild(hoehe = 14): { zeilen: string[]; cursor: [number, number] | null; status: string; fehler: boolean } {
    if (this.z < this.oben) this.oben = this.z;
    if (this.z >= this.oben + hoehe) this.oben = this.z - hoehe + 1;
    const breite = String(this.zeilen.length).length + 1;
    const zeilen: string[] = [];
    for (let i = 0; i < hoehe; i++) {
      const zi = this.oben + i;
      zeilen.push(zi < this.zeilen.length ? (this.nummern ? String(zi + 1).padStart(breite + 2) + ' ' : '') + this.zeilen[zi].replace(/\t/g, '        ') : '~');
    }
    const st = this.modus === 'befehl' ? ':' + this.eingabe : this.modus === 'suche' ? (this.suchRichtung ? '/' : '?') + this.eingabe : this.modus === 'einfuegen' ? '-- INSERT --' : this.meldung;
    const tabs = (this.zeile().slice(0, this.s).match(/\t/g) ?? []).length * 7;
    return { zeilen, cursor: this.modus === 'befehl' || this.modus === 'suche' ? null : [this.z - this.oben, this.s + tabs + (this.nummern ? breite + 3 : 0)], status: st, fehler: this.fehler && this.modus === 'normal' };
  }
}
