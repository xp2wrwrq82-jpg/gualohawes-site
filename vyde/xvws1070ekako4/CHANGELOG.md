# VYDE WEB — changelog
Newest first. Versioning rule: `~/.claude/CLAUDE.md` (STRICT). Version lives in `version.json` and `VERSION` in `vyde.js`.

## 1.0.0 — 2026-11-10
Gualo: "make vyde so i can send a link to my lil brother to use the camera app without downloading the app and can save
footage to phone correctly, it can be a private page on gualo.site link only for now".
- Private page at gualo.site/vyde/xvws1070ekako4/ (unguessable path, noindex/nofollow meta + X-Robots-Tag header,
  linked from nowhere, no sitemap). The bare /vyde/ path is the site's 404.
- The VYDE look in WebGL (two passes, real time at 30 fps): luma smear + pre-emphasis ringing, chroma bandwidth loss,
  chroma delay and line comb, chroma line drop-outs, phase noise, composite noise, snow, head switching at the bottom,
  edge wobble, rolling tracking band (EP). Three tapes: SP (VYDE iOS defaults), LP (worn), EP (chewed). Look strength
  0–200 % (LookBuilder scaling) and the TUBE colour drift with the iOS defaults (green→yellow .18, sky→purple .14,
  warmth .4, amount .85). As on iOS, the readouts are on screen only; the recorded picture is clean of OSD.
- VYDE's layout: tally + timecode (STBY/REC share one slot), VYDE mark, mode line, sound dials + dBFS + state;
  rail SET · TUBE · REC · TAPE · ZOOM · FLIP (+ LIGHT when the browser offers a torch). Portrait and landscape,
  safe areas. Settings and the take sheet on paper, light/dark by the phone.
- Recording: the processed canvas (captureStream 30) + mic through MediaRecorder; MP4 (H.264/AAC) first, WebM
  only if MP4 is missing. 4:3, 640×480 landscape / 480×640 portrait, drawn upright (no rotation flag). Steady 30 fps
  clock. Tape sound (hiss, 10 kHz ceiling, wow/flutter) optional, off by default (raw mic is the safest path).
- Save: preview of the take, then the share sheet with the file (iPhone: Save Video → Photos), download fallback.
  Names: VYDE_2026-11-10_1432.mp4 (-2, -3 for more takes in the same minute).
- A take closes cleanly and is kept if the page goes to the background; the camera wakes on return; screen wake lock.
- Proof: SYCSTEM-TEST-RECORDS/vyde-web/1.0.0/.
