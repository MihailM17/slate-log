//! Screenplay import: text-based PDFs in, scene list out.
//! Scene slugs follow a strict convention (`14 INT. LIFT STATION - DAY`),
//! so headings parse reliably. Everything else is ignored. Scanned/image
//! PDFs contain no text — those fail loudly instead of guessing.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedScene {
    pub number: String,
    pub int_ext: String,
    pub title: String,
    pub location: String,
    pub daypart: String,
    pub setups: Vec<String>,
}

/// Camera directions: matched but never imported.
const TRANSITIONS: &[&str] = &[
    "DISSOLVE TO",
    "CUT TO",
    "FADE IN",
    "FADE OUT",
    "SMASH CUT",
    "MATCH CUT",
    "JUMP CUT",
    "WIPE TO",
    "IRIS IN",
    "IRIS OUT",
    "FLASH CUT",
];

/// Shot framings, longest first so `BIG CLOSE UP` wins over `CLOSE UP`.
/// A line starting with one of these becomes a setup, not a scene.
const SHOT_KEYWORDS: &[&str] = &[
    "ESTABLISHING SHOT",
    "OVER THE SHOULDER",
    "FLASH CLOSE UP",
    "EXTREME CLOSE UP",
    "BIG CLOSE UP",
    "TRACKING SHOT",
    "AERIAL SHOT",
    "CRANE SHOT",
    "GROUP SHOT",
    "TWO SHOT",
    "MEDIUM SHOT",
    "LONG SHOT",
    "WIDE SHOT",
    "FULL SHOT",
    "CLOSE-UP",
    "CLOSE UP",
    "INSERT",
    "MONTAGE",
    "POV",
    "ECU",
    "MCU",
    "OTS",
    "MS",
    "LS",
    "WS",
];

fn boundary_ok(after: &str) -> bool {
    after.is_empty() || after.starts_with([' ', '-', '.', '/', ':'])
}

/// Longest keyword with a hard boundary, if any.
fn match_keyword<'a>(up: &'a str, words: &[&'a str]) -> Option<&'a str> {
    let mut best: Option<&str> = None;
    for w in words {
        if let Some(rest) = up.strip_prefix(w) {
            if boundary_ok(rest) && best.map(|b: &str| w.len() > b.len()).unwrap_or(true) {
                best = Some(w);
            }
        }
    }
    best
}

/// Leading production number (`14`, `14.`, `2A`, `144`) off any line.
fn strip_leading_number_text(t: &str) -> (String, &str) {
    if let Some(i) = t.find(char::is_whitespace) {
        let (head, tail) = t.split_at(i);
        let h = head.trim_end_matches(['.', ')']);
        if !h.is_empty() && h.chars().all(|c| c.is_ascii_digit() || c == 'A') {
            return (h.to_string(), tail.trim_start());
        }
    }
    (String::new(), t)
}

fn daypart_of(time: &str) -> &'static str {
    match time.trim().to_uppercase().as_str() {
        "NIGHT" => "Night",
        "DUSK" | "EVENING" | "SUNSET" | "MAGIC HOUR" => "Dusk",
        "DAWN" | "SUNRISE" => "Dawn",
        _ => "Day",
    }
}

/// Try one line. Returns None for anything that is not a slug.
fn parse_line(line: &str) -> Option<(ParsedScene, Vec<String>)> {
    let mut warnings = Vec::new();
    // Normalize dashes first (1:1 char swap, indices stay valid): scripts
    // use hyphens, en dashes and em dashes interchangeably as separators.
    let norm: String = line.trim().replace('–', "-").replace('—', "-");
    let t = norm.as_str();
    if t.is_empty() {
        return None;
    }
    // Slugs are conventionally ALL CAPS — this single rule kills nearly all
    // false positives from action lines and dialogue.
    if t.chars().any(|c| c.is_lowercase()) {
        return None;
    }
    let up = t.to_uppercase();
    // Optional leading production scene number: `14`, `14.`, `1)`, `2A`.
    let (number, rest) = strip_leading_number_text(&up);
    let mut rest = rest;
    // Transitions glued to the slug (`FADE IN: INT. ...`).
    for prefix in [
        "FADE IN:",
        "FADE OUT:",
        "CUT TO:",
        "DISSOLVE TO:",
        "SMASH CUT TO:",
        "MATCH CUT TO:",
        "CUT TO BLACK:",
        "FADE TO BLACK:",
    ] {
        if let Some(r) = rest.strip_prefix(prefix) {
            rest = r.trim_start();
            break;
        }
    }
    // Marker with a hard boundary so INTENTION / INTERIOR can't match.
    let (int_ext, after) = if let Some(r) = rest.strip_prefix("INT./EXT") {
        warnings.push("INT./EXT. treated as INT".to_string());
        ("INT", r)
    } else if let Some(r) = rest.strip_prefix("INT/EXT") {
        warnings.push("INT/EXT treated as INT".to_string());
        ("INT", r)
    } else if let Some(r) = rest.strip_prefix("INT") {
        ("INT", r)
    } else if let Some(r) = rest.strip_prefix("EXT") {
        ("EXT", r)
    } else if let Some(r) = rest.strip_prefix("EST") {
        ("EXT", r)
    } else if let Some(r) = rest.strip_prefix("I/E") {
        ("INT", r)
    } else {
        return None;
    };
    if !(after.is_empty() || after.starts_with(['.', ' ', '/'])) {
        return None;
    }
    let mut after = after.trim_start_matches(['.', ' ', '/']).trim();
    if after.is_empty() {
        return None;
    }
    // `EXT. LONG SHOT - LOBBY` describes framing, not place.
    if match_keyword(after, SHOT_KEYWORDS).is_some() {
        let w = match_keyword(after, SHOT_KEYWORDS).unwrap();
        after = after[w.len()..].trim_start_matches(['.', ' ', '-', '/']).trim();
        if after.is_empty() {
            return None;
        }
    }
    // `LOCATION - TIME`: time is the last dash-separated chunk.
    let chunks: Vec<&str> = after.split(" - ").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if chunks.is_empty() {
        return None;
    }
    let (location, daypart) = if chunks.len() >= 2 {
        let time = chunks[chunks.len() - 1];
        let loc = chunks[..chunks.len() - 1].join(" - ");
        (loc, daypart_of(time).to_string())
    } else {
        (chunks[0].to_string(), "Day".to_string())
    };
    // Recover original-cased text for the location/title.
    let orig_loc = {
        let idx = t.to_uppercase().find(&location).unwrap_or(0);
        t[idx..(idx + location.len()).min(t.len())].trim().to_string()
    };
    let title = if orig_loc.is_empty() { location.clone() } else { orig_loc.clone() };
    Some((
        ParsedScene {
            number,
            int_ext: int_ext.to_string(),
            title,
            location: orig_loc,
            daypart,
            setups: Vec::new(),
        },
        warnings,
    ))
}

/// A camera-direction line (`MEDIUM SHOT - #7 AND #10`) becomes a setup
/// name. Transitions (`DISSOLVE TO:`) and everything else return None.
fn parse_shot_line(line: &str) -> Option<String> {
    let norm: String = line.trim().replace('–', "-").replace('—', "-");
    let t = norm.as_str();
    if t.is_empty() || t.chars().any(|c| c.is_lowercase()) {
        return None;
    }
    let up = t.to_uppercase();
    let (_, rest) = strip_leading_number_text(&up);
    if match_keyword(rest, TRANSITIONS).is_some() {
        return None;
    }
    match_keyword(rest, SHOT_KEYWORDS)?;
    // Name keeps the original casing, minus any leading page number.
    Some(strip_leading_number_text(t).1.trim().to_string())
}

/// Parse a whole screenplay. Returns (scenes, warnings)./// Shot lines attach as setups to the most recent scene (or the first
/// scene, for cold opens before any slug); transitions are dropped.
pub fn parse_screenplay(text: &str) -> (Vec<ParsedScene>, Vec<String>) {
    let mut scenes: Vec<ParsedScene> = Vec::new();
    let mut pending: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let push_setup = |scenes: &mut Vec<ParsedScene>, pending: &mut Vec<String>, name: String| {
        if scenes.iter().any(|s| s.setups.iter().any(|x| x == &name)) || pending.contains(&name) {
            return;
        }
        match scenes.last_mut() {
            Some(s) => s.setups.push(name),
            None => pending.push(name),
        }
    };
    for line in text.lines() {
        if let Some((mut s, w)) = parse_line(line) {
            // Number bare slugs sequentially; numbered ones keep theirs.
            if s.number.is_empty() {
                s.number = (scenes.len() + 1).to_string();
            }
            scenes.push(s);
            for x in w {
                if warnings.len() < 20 && !warnings.contains(&x) {
                    warnings.push(x);
                }
            }
        } else if let Some(name) = parse_shot_line(line) {
            push_setup(&mut scenes, &mut pending, name);
        }
    }
    if !pending.is_empty() {
        match scenes.first_mut() {
            Some(s) => {
                for name in pending.drain(..) {
                    if !s.setups.contains(&name) {
                        s.setups.push(name);
                    }
                }
            }
            None => warnings.push("shot lines found but no scenes — nothing to attach them to".to_string()),
        }
    }
    (scenes, warnings)
}

/// Last-resort text recovery for PDFs whose cross-reference tables are
/// broken (strict parsers reject the whole file). Scans raw bytes for
/// content streams, inflates them, and pulls out text-showing operators.
/// Ignores layout — good enough for slug detection.
pub fn extract_raw_text(bytes: &[u8]) -> String {
    use std::io::Read;
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let rel = find_sub(&bytes[i..], b"stream");
        let start = match rel {
            Some(r) => i + r,
            None => break,
        };
        let mut data = start + 6;
        if bytes.get(data) == Some(&b'\r') {
            data += 1;
        }
        if bytes.get(data) == Some(&b'\n') {
            data += 1;
        }
        let end = match find_sub(&bytes[data..], b"endstream") {
            Some(r) => data + r,
            None => break,
        };
        let chunk = &bytes[data..end];
        // Try zlib-wrapped deflate (FlateDecode), then raw deflate.
        let mut inflated = Vec::new();
        let decoded = flate2::read::ZlibDecoder::new(chunk)
            .read_to_end(&mut inflated)
            .is_ok()
            .then(|| std::mem::take(&mut inflated))
            .or_else(|| {
                let mut raw = Vec::new();
                flate2::read::DeflateDecoder::new(chunk)
                    .read_to_end(&mut raw)
                    .is_ok()
                    .then_some(raw)
            });
        if let Some(buf) = decoded {
            out.push_str(&scrape_ops(&buf));
            out.push('\n');
        }
        i = end + 9;
    }
    out
}

fn find_sub(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Pull `(...) Tj`, `[...] TJ`, `..'..` and `..”..` strings out of a
/// decompressed content stream. Line structure comes from positioning
/// operators (`Td`/`TD`/`Tm` newlines, `T*`/`'`/`"` next-line shows);
/// without them, fragments join with spaces.
fn scrape_ops(buf: &[u8]) -> String {
    let s = String::from_utf8_lossy(buf);
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    let push_part = |cur: &mut String, parts: &mut Vec<String>| {
        let t = cur.trim().to_string();
        if !t.is_empty() {
            parts.push(t);
        }
        cur.clear();
    };
    while i < bytes.len() {
        if bytes[i] == b'(' {
            let (lit, next) = take_literal(bytes, i);
            // Look ahead for the operator: Tj, ', " or TJ-context.
            let mut j = next;
            while j < bytes.len() && (bytes[j] as char).is_whitespace() {
                j += 1;
            }
            if bytes.get(j..j + 2) == Some(b"Tj".as_slice())
                || bytes.get(j) == Some(&b'\'')
                || bytes.get(j) == Some(&b'"')
            {
                if !cur.is_empty() && !cur.ends_with(' ') {
                    cur.push(' ');
                }
                cur.push_str(&decode_literal(&lit));
            }
            i = next;
        } else if bytes[i] == b'[' {
            if let Some(end) = find_sub(&bytes[i..], b"]") {
                let inner = &bytes[i + 1..i + end];
                let mut k = 0;
                let mut joined = String::new();
                let mut gap = false;
                while k < inner.len() {
                    if inner[k] == b'(' {
                        let (lit, next) = take_literal(inner, k);
                        if gap && !joined.is_empty() && !joined.ends_with(' ') {
                            joined.push(' ');
                        }
                        joined.push_str(&decode_literal(&lit));
                        gap = false;
                        k = next;
                    } else if inner[k] == b'-' || inner[k].is_ascii_digit() {
                        // Kerning number: large negative = word gap.
                        let mut j = k;
                        if inner[j] == b'-' {
                            j += 1;
                        }
                        while j < inner.len() && (inner[j].is_ascii_digit() || inner[j] == b'.') {
                            j += 1;
                        }
                        if let Ok(v) = std::str::from_utf8(&inner[k..j]).unwrap_or("").parse::<f32>() {
                            if v < -100.0 {
                                gap = true;
                            }
                        }
                        k = j;
                    } else {
                        k += 1;
                    }
                }
                // Operator must follow the array.
                let mut j = i + end + 1;
                while j < bytes.len() && (bytes[j] as char).is_whitespace() {
                    j += 1;
                }
                if bytes.get(j..j + 2) == Some(b"TJ".as_slice()) && !joined.trim().is_empty() {
                    if !cur.is_empty() && !cur.ends_with(' ') {
                        cur.push(' ');
                    }
                    cur.push_str(joined.trim());
                }
                i = i + end + 1;
            } else {
                i += 1;
            }
        } else if bytes[i] == b'T' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                // Positioning / next-line operators end the current line.
                // (`Tj`/`TJ`/`Tf` handled above or skipped.)
                b'd' | b'D' | b'm' | b'*' => {
                    push_part(&mut cur, &mut parts);
                    i += 2;
                }
                _ => {
                    i += 1;
                }
            }
        } else if bytes[i] == b'\'' || bytes[i] == b'"' {
            push_part(&mut cur, &mut parts);
            i += 1;
        } else {
            i += 1;
        }
    }
    push_part(&mut cur, &mut parts);
    parts.join("\n")
}

/// Read a `(...)` literal starting at the opening paren. Returns the raw
/// inner bytes and the index just past the closing paren.
fn take_literal(buf: &[u8], start: usize) -> (Vec<u8>, usize) {
    let mut out = Vec::new();
    let mut i = start + 1;
    let mut depth = 1;
    while i < buf.len() && depth > 0 {
        match buf[i] {
            b'\\' if i + 1 < buf.len() => {
                out.push(buf[i]);
                out.push(buf[i + 1]);
                i += 2;
            }
            b'(' => {
                depth += 1;
                out.push(buf[i]);
                i += 1;
            }
            b')' => {
                depth -= 1;
                if depth > 0 {
                    out.push(buf[i]);
                }
                i += 1;
            }
            _ => {
                out.push(buf[i]);
                i += 1;
            }
        }
    }
    (out, i)
}

/// Decode literal bytes: escapes, octal, UTF-16BE, else Win-1252-ish.
fn decode_literal(raw: &[u8]) -> String {
    let mut bytes: Vec<u8> = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'\\' && i + 1 < raw.len() {
            match raw[i + 1] {
                b'n' => { bytes.push(b'\n'); i += 2; }
                b'r' => { bytes.push(b'\r'); i += 2; }
                b't' => { bytes.push(b'\t'); i += 2; }
                b'b' => { bytes.push(0x08); i += 2; }
                b'f' => { bytes.push(0x0C); i += 2; }
                b'(' | b')' | b'\\' => { bytes.push(raw[i + 1]); i += 2; }
                d if d.is_ascii_digit() => {
                    let mut v: u32 = 0;
                    let mut n = 0;
                    while n < 3 && i + 1 + n < raw.len() && raw[i + 1 + n].is_ascii_digit() && raw[i + 1 + n] < b'8' {
                        v = v * 8 + (raw[i + 1 + n] - b'0') as u32;
                        n += 1;
                    }
                    if n > 0 {
                        bytes.push(v.min(255) as u8);
                        i += 1 + n;
                    } else {
                        i += 1;
                    }
                }
                _ => { i += 2; }
            }
        } else {
            bytes.push(raw[i]);
            i += 1;
        }
    }
    // UTF-16BE with BOM.
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        return bytes[2..]
            .chunks(2)
            .filter_map(|c| {
                if c.len() == 2 {
                    char::from_u32(((c[0] as u32) << 8) | c[1] as u32)
                } else {
                    None
                }
            })
            .collect();
    }
    bytes.iter().map(|&b| win1252(b)).collect()
}

fn win1252(b: u8) -> char {
    match b {
        0x80 => '€', 0x82 => '‚', 0x83 => 'ƒ', 0x84 => '„', 0x85 => '…',
        0x86 => '†', 0x87 => '‡', 0x88 => 'ˆ', 0x89 => '‰', 0x8A => 'Š',
        0x8B => '‹', 0x8C => 'Œ', 0x91 => '‘', 0x92 => '’', 0x93 => '“',
        0x94 => '”', 0x95 => '•', 0x96 => '–', 0x97 => '—', 0x98 => '˜',
        0x99 => '™', 0x9A => 'š', 0x9B => '›', 0x9C => 'œ', 0x9E => 'ž',
        0x9F => 'Ÿ',
        _ => b as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        let (scenes, _) = parse_screenplay(
            "FADE IN:\n\n14   INT. ABANDONED LIFT STATION - DAY\n\nDust hangs.\n\nEXT. CHAIRLIFT LINE - DUSK\n\nHe INTENTIONALLY waits.\n\nINTENTION is everything.\n\n2A  EXT. RIDGE HUT - NIGHT\n",
        );
        assert_eq!(scenes.len(), 3);
        assert_eq!(scenes[0].number, "14");
        assert_eq!(scenes[0].int_ext, "INT");
        assert_eq!(scenes[0].daypart, "Day");
        assert_eq!(scenes[1].int_ext, "EXT");
        assert_eq!(scenes[1].daypart, "Dusk");
        assert_eq!(scenes[1].number, "2");
        assert_eq!(scenes[2].number, "2A");
        assert_eq!(scenes[2].daypart, "Night");
    }

    #[test]
    fn raw_scrape_finds_slugs() {
        use std::io::Write;
        // Minimal PDF: broken xref on purpose — only the stream matters.
        let content = b"BT /F1 12 Tf 72 720 Td (1 INT. LOBBY - DAY) Tj ET BT 72 700 Td [(MEDIUM) -200 (SHOT - #8)] TJ ET";
        let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(content).unwrap();
        let deflated = enc.finish().unwrap();
        let mut pdf = b"%PDF-1.4\n".to_vec();
        pdf.extend_from_slice(b"1 0 obj << /Length 99 >>\nstream\n");
        pdf.extend_from_slice(&deflated);
        pdf.extend_from_slice(b"\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n");
        let text = extract_raw_text(&pdf);
        let (scenes, _) = parse_screenplay(&text);
        assert_eq!(scenes.len(), 1);
        assert_eq!(scenes[0].number, "1");
        assert_eq!(scenes[0].setups, vec!["MEDIUM SHOT - #8".to_string()]);
    }

    #[test]
    fn rejects_prose() {
        let (scenes, _) = parse_screenplay("The interior of the station.\nAn EXTREMELY loud noise.\ninterior monologue\n");
        assert!(scenes.is_empty());
    }

    #[test]
    fn shot_script() {
        // Shooting-script style: one slug, then bare shot lines.
        let text = "1 EXT. LONG SHOT - N. Y. - COURT OF GENERAL SESSIONS - DAY 1\n\
                    LONG SHOT - THE LOBBY\n\
                    MEDIUM SHOT - #7 AND #10\n\
                    DISSOLVE TO:\n\
                    CLOSE UP - #8\n\
                    144 MEDIUM SHOT - FOREMAN AND OTHERS 144\n\
                    JUDGE\nPardon me.\n\
                    12 ANGRY MEN\n";
        let (scenes, _) = parse_screenplay(text);
        assert_eq!(scenes.len(), 1);
        assert_eq!(scenes[0].number, "1");
        assert_eq!(scenes[0].int_ext, "EXT");
        assert_eq!(scenes[0].location, "N. Y. - COURT OF GENERAL SESSIONS");
        assert_eq!(scenes[0].daypart, "Day");
        assert_eq!(scenes[0].setups.len(), 4);
        assert!(scenes[0].setups[0].contains("LOBBY"));
        assert!(scenes[0].setups[1].contains("#7 AND #10"));
        assert!(scenes[0].setups[3].contains("FOREMAN"));
    }

    #[test]
    fn orphan_shots_wait_for_first_scene() {
        let (scenes, _) = parse_screenplay("CLOSE UP - HANDS\n2 INT. ROOM - NIGHT\n");
        assert_eq!(scenes.len(), 1);
        assert_eq!(scenes[0].setups, vec!["CLOSE UP - HANDS".to_string()]);
    }

    #[test]
    fn transitions_numbers_dashes() {
        // Real-world slug: dotted number, glued transition, en dash.
        let (scenes, _) = parse_screenplay(
            "1.  FADE IN: INT. ЧАСОВНИКАРСКА РАБОТИЛНИЦА – AFTERNOON\nFADE OUT: КРАЙ\n2) EXT. RIVER - NIGHT\n",
        );
        assert_eq!(scenes.len(), 2);
        assert_eq!(scenes[0].number, "1");
        assert_eq!(scenes[0].int_ext, "INT");
        assert_eq!(scenes[0].location, "ЧАСОВНИКАРСКА РАБОТИЛНИЦА");
        assert_eq!(scenes[0].daypart, "Day");
        assert_eq!(scenes[1].number, "2");
        assert_eq!(scenes[1].int_ext, "EXT");
        assert_eq!(scenes[1].daypart, "Night");
    }
}
