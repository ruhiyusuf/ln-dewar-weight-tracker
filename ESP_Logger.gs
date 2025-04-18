function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var now = new Date();
  var raw = "";
  var weight = 0;
  var isStable = "Unstable";
  var label = "";
  var parseSuccess = false;

  // Parse JSON
  try {
    var data = JSON.parse(e.postData.contents);
    raw = data.raw || "";
  } catch (err) {
    return ContentService.createTextOutput("Invalid JSON");
  }

  // Detect Stable vs Unstable
  if (raw.startsWith("ST,")) {
    isStable = "Stable";
  }

  // Extract weight and label using strict match
  try {
    var match = raw.match(/\+([0-9.]+)([a-zA-Z]+)/);  // Match "+0000.00lb"
    if (match && match[1] && match[2]) {
      weight = parseFloat(match[1]);
      label = match[2];
      parseSuccess = true;
    }
  } catch (_) {}

  // Get last valid weight (from last non-zero, valid row)
  var lastRow = sheet.getLastRow();
  var lastWeight = null;
  for (var i = lastRow; i > 1; i--) {
    var w = sheet.getRange(i, 3).getValue(); // 3rd column = weight
    if (typeof w === "number" && w > 0) {
      lastWeight = w;
      break;
    }
  }

  // Filter out sudden invalid jumps (e.g., 63 → 8 lb)
  var MAX_JUMP = 2.0;  // adjust based on expected rate of change
  if (lastWeight !== null && Math.abs(weight - lastWeight) > MAX_JUMP) {
    parseSuccess = false;
  }

  // Append to sheet only if data was successfully parsed and not a jump
  if (parseSuccess) {
    sheet.appendRow([now, isStable, weight, label]);
  } else {
    sheet.appendRow([now, "Invalid", 0, raw]);
  }

  // Threshold alert logic
  var WEIGHT_THRESHOLD = 30.0;
  var props = PropertiesService.getScriptProperties();
  var alertSent = props.getProperty("alert_sent") === "true";

  if (parseSuccess && weight < WEIGHT_THRESHOLD && !alertSent) {
    MailApp.sendEmail({
      to: "<enter email address>",
      subject: "⚠️ Liquid Nitrogen Weight Alert",
      body: "Weight has dropped below the threshold!\n" +
            "Current: " + weight.toFixed(2) + " " + label + "\n" +
            "Logged at: " + now + "\n\n" +
            "Raw input: " + raw + "\n\n" +
            "You can view the plot of weight data over time here:\n" +
            "<enter google sheet link>"
    });
    props.setProperty("alert_sent", "true");
  } else if (parseSuccess && weight >= WEIGHT_THRESHOLD && alertSent) {
    props.setProperty("alert_sent", "false");
  }

  return ContentService.createTextOutput("OK");
}
