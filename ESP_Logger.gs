/**********************
 * Liquid N2 Webhook (rate-limited logging + one-shot alerts)
 * - Accepts ONLY: ST,GS,+0039.64lb
 * - Writes to Sheet1 at most once per MIN_INTERVAL_MS (valid rows only)
 * - One email per downward crossing of threshold; re-arms after rising above threshold + RESET_MARGIN
 * - Threshold changes start a new "epoch" (no immediate alert; wait for next drop)
 **********************/

var DEBUG_ENABLED = false;   // flip to true when you want logs

function clearData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet1");
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
}

function getConfigValue(key) {
  const cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Config");
  if (!cfg) return null;
  const rows = cfg.getRange(1, 1, cfg.getLastRow(), 2).getValues();
  for (let i = 0; i < rows.length; i++) if (rows[i][0] === key) return rows[i][1];
  return null;
}

function dbg(sh, note, o) {
  if (!DEBUG_ENABLED) return;  // do nothing if debug is off
  sh.appendRow([
    new Date(),
    note || "",
    o.raw ?? "",
    o.weight ?? "",
    o.thr ?? "",
    o.margin ?? "",
    o.armed ?? "",
    o.sent ?? "",
    o.last_thr ?? "",
    o.tchanged ?? "",
    o.lock ?? "",
    o.reason ?? ""
  ]);
}

function doPost(e) {
  // ---- Config ----
  var WEIGHT_THRESHOLD  = parseFloat(getConfigValue("WEIGHT_THRESHOLD"))  || 34.4;  // lbs
  var MAX_JUMP          = parseFloat(getConfigValue("MAX_JUMP"))          || 2.0;   // lbs per reading
  var MIN_INTERVAL_MS   = parseInt(getConfigValue("MIN_INTERVAL_MS"))     || (5 * 60 * 1000); // 5 min
  var RECIPIENT_EMAILS  =                getConfigValue("RECIPIENT_EMAILS") || "ruhiy@umich.edu";
  var RESET_MARGIN      = parseFloat(getConfigValue("RESET_MARGIN"))      || 0.3;   // lbs above threshold to reset/re-arm
  var BCC_EMAIL         =                getConfigValue("BCC_EMAIL")      || "ruhiy@umich.edu";

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sheet1") || ss.getActiveSheet();
  var dbgSheet = ss.getSheetByName("Debug") || ss.insertSheet("Debug");

  var now = new Date();
  var raw = "";
  var weight = 0;
  var label = "";
  var isStable = "Unstable";

  // ---- Parse JSON body ----
  try {
    if (!e || !e.postData || !e.postData.contents) return ContentService.createTextOutput("No body");
    var data = JSON.parse(e.postData.contents);
    raw = (data.raw || "").trim();
  } catch (err) {
    return ContentService.createTextOutput("Invalid JSON");
  }

  // ---- STRICT packet: must be exactly "ST,GS,+0039.64lb" ----
  var strict = raw.match(/^ST,GS,\+(\d{4})\.(\d{2})lb$/);
  if (strict) {
    isStable = "Stable";
    weight = parseFloat(strict[1] + "." + strict[2]); // "0039" + "." + "64" -> 39.64
    label = "lb";
  } else {
    // reject quietly (no sheet write here)
    dbg(dbgSheet, "REJECT_FORMAT", {raw: raw, reason:"bad packet"});
    return ContentService.createTextOutput("Rejected: Bad format");

  }

  // ---- Fetch last valid weight from sheet (for jump filter) ----
  var lastRow = sheet.getLastRow();
  var lastWeight = null;
  for (var i = lastRow; i > 1; i--) {
    var w = sheet.getRange(i, 3).getValue(); // col C = weight
    if (typeof w === "number" && w > 0) { lastWeight = w; break; }
  }

  // ---- Reject improbable jumps ----
  if (lastWeight !== null && Math.abs(weight - lastWeight) > MAX_JUMP) {
    dbg(dbgSheet, "REJECT_JUMP", {
      raw: raw, weight: weight, thr: WEIGHT_THRESHOLD,
      reason: ">|Δ| "+Math.abs(weight-(lastWeight||0))+" > "+MAX_JUMP
    });
    return ContentService.createTextOutput("Rejected: Sudden jump");
  }

  var props = PropertiesService.getScriptProperties();

  // ---- RATE-LIMITED LOGGING (valid rows only) ----
  var logLock = LockService.getScriptLock();
  if (logLock.tryLock(30 * 1000)) {
    try {
      var lastLogTimeStr = props.getProperty("last_log_time");
      var lastLogTime = lastLogTimeStr ? new Date(lastLogTimeStr) : null;

      if (!lastLogTime || (now.getTime() - lastLogTime.getTime()) >= MIN_INTERVAL_MS) {
        sheet.appendRow([now, isStable, weight, label]);
        props.setProperty("last_log_time", now.toISOString());
      }
      dbg(dbgSheet, "RATE_LIMIT_SKIP", {raw: raw, weight: weight});

    } finally {
      logLock.releaseLock();
    }
  }
  // If we couldn't get the lock, we just skip logging this request.

// ---- ALERTS (edge detection: prev >= thr AND current < thr) ----
  var alertLock = LockService.getScriptLock();
  var got = alertLock.tryLock(30 * 1000);
  dbg(dbgSheet, "ALERT_LOCK", {raw: raw, weight: weight, lock: got});
  if (got) {
    try {
      var EPS = 1e-6;

      var alertSent = (props.getProperty("alert_sent") === "true");
      var lastAlertThresholdStr = props.getProperty("last_alert_threshold");
      var lastAlertThreshold = lastAlertThresholdStr ? parseFloat(lastAlertThresholdStr) : null;

      // Previous valid reading for edge detection
      var prevWeightStr = props.getProperty("prev_weight");
      var prevWeight = prevWeightStr ? parseFloat(prevWeightStr) : null;

      // Detect threshold change → start new epoch
      var thresholdChanged = (lastAlertThreshold === null) ||
                            (Math.abs(WEIGHT_THRESHOLD - lastAlertThreshold) > 1e-9);
      dbg(dbgSheet, "PROPS_LOADED", {
        raw: raw, weight: weight, thr: WEIGHT_THRESHOLD, margin: RESET_MARGIN,
        sent: alertSent, last_thr: lastAlertThreshold, tchanged: thresholdChanged,
        prev: prevWeight
      });

      if (thresholdChanged) {
        props.setProperty("last_alert_threshold", String(WEIGHT_THRESHOLD));
        props.setProperty("alert_sent", "false");
        alertSent = false;
        dbg(dbgSheet, "AFTER_EPOCH", {
          raw: raw, weight: weight, thr: WEIGHT_THRESHOLD, margin: RESET_MARGIN,
          sent: alertSent, last_thr: WEIGHT_THRESHOLD
        });
      }

      // Hysteresis re-arm: once back above thr + margin, allow a new alert
      if (weight >= WEIGHT_THRESHOLD + RESET_MARGIN) {
        if (alertSent) props.setProperty("alert_sent", "false");
        alertSent = false;
        dbg(dbgSheet, "AFTER_REARM", {raw: raw, weight: weight, thr: WEIGHT_THRESHOLD, margin: RESET_MARGIN, sent: alertSent});
      }

      // Edge detection: prev >= thr AND current < thr (with epsilon)
      var crossedDown =
        (prevWeight !== null) &&
        (prevWeight >= WEIGHT_THRESHOLD - EPS) &&
        (weight     <  WEIGHT_THRESHOLD + EPS);

      dbg(dbgSheet, "PRE_FIRE", {
        raw: raw, weight: weight, prev: prevWeight, thr: WEIGHT_THRESHOLD,
        crossedDown: crossedDown, sent: alertSent
      });

      if (crossedDown && !alertSent) {
        try {
          MailApp.sendEmail({
            to: RECIPIENT_EMAILS,
            bcc: BCC_EMAIL,
            subject: "⚠️ Liquid Nitrogen Weight Alert",
            body:
              "Weight has dropped below the threshold!\n" +
              "Prev:    " + (prevWeight != null ? prevWeight.toFixed(2) : "n/a") + " " + label + "\n" +
              "Current: " + weight.toFixed(2) + " " + label + "\n" +
              "Threshold: " + WEIGHT_THRESHOLD.toFixed(2) + " lb\n" +
              "Logged at: " + now + "\n\n" +
              "Raw input: " + raw + "\n\n" +
              "View plot:\n" +
              "https://docs.google.com/spreadsheets/d/1IpvrMlIukxfOZhGvwZEy9wxlRCNOpis6IwRlfZouqJs/edit?gid=0#gid=0"
          });
          dbg(dbgSheet, "FIRED_EMAIL", {prev: prevWeight, weight: weight, thr: WEIGHT_THRESHOLD});
          props.setProperty("alert_sent", "true");
          props.setProperty("last_alert_weight", String(weight));
        } catch (err) {
          dbg(dbgSheet, "MAIL_ERROR", {err: String(err)});
        }
      }

      // Always update prev_weight to the latest valid reading
      props.setProperty("prev_weight", String(weight));

      // For your existing Script Properties view, keep 'alert_armed' meaningful:
      // here it just mirrors "ready to fire again if we go below"
      var armedNow = !alertSent && (weight >= WEIGHT_THRESHOLD - EPS);
      props.setProperty("alert_armed", armedNow ? "true" : "false");

    } finally {
      try { alertLock.releaseLock(); } catch (_) {}
    }
  } else {
    dbg(dbgSheet, "ALERT_SKIPPED_NOLOCK", {raw: raw, weight: weight, reason:"lock contention"});
    return ContentService.createTextOutput("OK");
  }
}
