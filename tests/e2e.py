#!/usr/bin/env python3
# Spielt Missionen im Browser mit den Lösungen aus tests/loesungen.json durch und prüft, ob sie als geschafft gelten.
#
#   npm run build && npx astro preview --port 4321 &
#   python3 tests/e2e.py                       # alle spielbaren Missionen
#   python3 tests/e2e.py l2-5-1,l2-5-2 VORHER  # nur diese, VORHER = schon abgeschlossene IDs (Komma)
#
# Umgebung: LTH_URL (Standard http://localhost:4321), CHROME (Pfad zu Chrome, sonst das Chromium von Playwright).
# Braucht: pip install playwright
import asyncio, json, os, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright
HIER = Path(__file__).resolve().parent
B = os.environ.get('LTH_URL', 'http://localhost:4321').rstrip('/')
_L = json.loads((HIER / 'loesungen.json').read_text(encoding='utf-8'))
TERM = {tuple(k.split('/')): (v['befehle'], v['antworten']) for k, v in _L.items()}
import sys
ALLE = subprocess.run(['node', str(HIER / 'missionen.mjs')], capture_output=True, text=True, check=True).stdout.strip().split(',')
MISSIONEN = sys.argv[1].split(',') if len(sys.argv) > 1 and sys.argv[1] else ALLE
VORHER = sys.argv[2].split(',') if len(sys.argv) > 2 else ALLE[:ALLE.index(MISSIONEN[0])] if MISSIONEN[0] in ALLE else []
async def main():
    async with async_playwright() as p:
        opt = {'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}
        b = await p.chromium.launch(args=['--no-sandbox'], **opt)
        nicht = []
        pg = await b.new_page(viewport={'width':1280,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(B+'/')
        await pg.evaluate("localStorage.clear(); localStorage.setItem('lth:einstellungen', JSON.stringify({schritte:false}))")
        await pg.evaluate("ids => localStorage.setItem('linuxtohero:v1', JSON.stringify({v:1,ohneHardware:false,missionen:Object.fromEntries(ids.map(i=>[i,{status:'real',xp:50,am:'2026-11-20T10:00:00Z'}])),checks:{},fehlversuche:{},abzeichen:[],wiederholen:{},proben:[]}))", VORHER)
        for mid in MISSIONEN:
            await pg.goto(f'{B}/mission/{mid}')
            hw = pg.locator('[data-kw-ohne-hardware]')
            if await hw.count(): await hw.check()
            for st in await pg.locator('[data-kw-check]').all():
                cid = await st.get_attribute('data-kw-check')
                if await st.locator('[data-kw-quiz]').count():
                    fr = json.loads(await st.locator('[data-kw-quiz]').get_attribute('data-fragen'))
                    for fs in await st.locator('fieldset.frage').all():
                        f = fr[int(await fs.get_attribute('data-i'))]
                        for inp_ in await fs.locator('input').all():
                            if await inp_.get_attribute('value') == f['richtig']: await inp_.check()
                    await st.locator('button[type=submit]').click()
                elif await st.locator('[data-kw-zuordnung]').count():
                    paare = json.loads(await st.locator('[data-kw-zuordnung]').get_attribute('data-paare'))
                    for i,pa in enumerate(paare): await st.locator(f'select[data-i="{i}"]').select_option(pa['rechts'])
                    await st.locator('button[type=submit]').click()
                elif await st.locator('[data-kw-reihe]').count():
                    ri = json.loads(await st.locator('[data-kw-reihe]').get_attribute('data-schritte'))
                    for i,t in enumerate(ri):
                        while True:
                            items = [await x.inner_text() for x in await st.locator('.rf-liste li span').all()]
                            j = items.index(t)
                            if j == i: break
                            await st.locator('.rf-liste li').nth(j).locator('button').first.click()
                    await st.locator('[data-rf-pruefen]').click()
                elif await st.locator('[data-kw-luecke]').count():
                    lu = json.loads(await st.locator('[data-kw-luecke]').get_attribute('data-luecken'))
                    for i,l in enumerate(lu): await st.locator('.lt-feld').nth(i).fill(l['loesungen'][0])
                    await st.locator('button[type=submit]').click()
                elif await st.locator('[data-kw-bestaetigung]').count():
                    await st.locator('input[type=checkbox]').check(); await st.locator('button[type=submit]').click()
                elif await st.locator('[data-kw-log]').count():
                    fa = json.loads(await st.locator('[data-kw-log]').get_attribute('data-faelle'))
                    for _ in range(int(await st.locator('[data-kw-log]').get_attribute('data-anzahl'))):
                        sym = await st.locator('[data-ld-symptom]').inner_text()
                        f = next(x for x in fa if x['symptom'] in sym)
                        for lab in await st.locator('[data-ld-wahl] label').all():
                            if (await lab.inner_text()).strip() == f['richtig']: await lab.locator('input').check()
                        await st.locator('[data-ld-abgeben]').click()
                elif await st.locator('[data-kw-probe]').count():
                    pool = json.loads(await st.locator('[data-kw-probe]').get_attribute('data-pool'))
                    N = int(await st.locator('[data-kw-probe]').get_attribute('data-anzahl'))
                    await st.locator('[data-p-los]').click()
                    for i in range(N):
                        txt = await st.locator('[data-p-frage] legend').inner_text()
                        f = next((f for f in pool if f['frage'].strip() in txt), None)
                        if not f: print('  PROBE: Frage unbekannt', txt[:80]); 
                        elif f['typ']=='eingabe': await st.locator('[data-p-frage] input').fill(f['richtig'][0])
                        else:
                            for lab in await st.locator('[data-p-frage] label').all():
                                if (await lab.inner_text()).strip() in [f['optionen'][k].strip() for k in f['richtig']]: await lab.locator('input').check()
                        if i < N-1: await st.locator('[data-p-weiter]').click()
                    pg.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
                    await st.locator('[data-p-abgeben]').click()
                    await pg.wait_for_timeout(800)
                elif await st.locator('[data-kw-term]').count():
                    if (mid, cid) not in TERM: print('  KEINE LÖSUNG in loesungen.json für', f'{mid}/{cid}'); continue
                    cmds, antw = TERM[(mid,cid)]
                    inp = st.locator('[data-term-eingabe]')
                    for c in cmds:
                        if c == '#neustart': await st.locator('[data-term-neustart]').click(); continue
                        if c == '#strg-c': await st.locator('[data-term-taste="c"]').click(); continue
                        if c == '#strg-z': await st.locator('[data-term-taste="z"]').click(); continue
                        if c == '#strg-d': await st.locator('[data-term-taste="d"]').click(); continue
                        if c.startswith('#vi:'):
                            k = c[4:]
                            if k in ('Escape','Enter','Backspace'): await inp.press(k)
                            else: await inp.type(k)
                            continue
                        await inp.fill(c); await inp.press('Enter')
                    for i,fo in enumerate(await st.locator('.a-frage').all()):
                        await fo.locator('input').fill(antw[i]); await fo.locator('button').click()
                    if await st.locator('[data-kw-status]').inner_text() != 'Bestanden':
                        offen = [await li.inner_text() for li in await st.locator('[data-term-aufgaben] > li:not(.fertig)').all()]
                        print('  OFFEN', mid, cid, [o[:70] for o in offen])
                status = await st.locator('[data-kw-status]').inner_text()
                if status not in ('Bestanden','Übersprungen (ohne Labor)'): print('  !!', mid, cid, status, '|', (await st.locator('[data-kw-meldung]').inner_text())[:150])
            bel = await pg.locator('[data-kw-belohnung]').is_visible()
            if not bel: nicht.append(mid)
            print(mid, 'geschafft' if bel else 'NICHT geschafft', await pg.locator('[data-bel-titel]').inner_text() if bel else '')
        print('Fehler auf den Seiten:', errs or 'keine')
        print(f'{len(MISSIONEN) - len(nicht)} von {len(MISSIONEN)} geschafft')
        await b.close()
        return 1 if nicht or errs else 0
sys.exit(asyncio.run(main()))
