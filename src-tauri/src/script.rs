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

/// Parse a whole screenplay. Returns (scenes, warnings).
/// Shot lines attach as setups to the most recent scene (or the first
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
