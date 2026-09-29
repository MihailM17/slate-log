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
    let mut rest = up.as_str();
    let mut number = String::new();
    if let Some(i) = rest.find(char::is_whitespace) {
        let (head, tail) = rest.split_at(i);
        let head = head.trim_end_matches(['.', ')']);
        if !head.is_empty() && head.chars().all(|c| c.is_ascii_digit() || c == 'A') {
            number = head.to_string();
            rest = tail.trim_start();
        }
    }
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
    let after = after.trim_start_matches(['.', ' ', '/']).trim();
    if after.is_empty() {
        return None;
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
        },
        warnings,
    ))
}

/// Parse a whole screenplay. Returns (scenes, warnings).
pub fn parse_screenplay(text: &str) -> (Vec<ParsedScene>, Vec<String>) {
    let mut scenes = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    for line in text.lines() {
        if let Some((mut s, w)) = parse_line(line) {
            // Number bare slugs sequentially; numbered ones keep their numbers.
            if s.number.is_empty() {
                s.number = (scenes.len() + 1).to_string();
            }
            scenes.push(s);
            for x in w {
                if warnings.len() < 20 && !warnings.contains(&x) {
                    warnings.push(x);
                }
            }
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
