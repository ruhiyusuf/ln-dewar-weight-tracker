# Liquid Nitrogen Dewar Weight Tracker

A liquid nitrogen dewar monitoring system that uses an ESP32 and a serial-enabled digital scale to automatically log dewar weight to Google Sheets and send Gmail notifications when the weight falls below a configurable threshold.

## Features

- Real-time dewar weight monitoring
- Google Sheets data logging
- Configurable alert thresholds
- Multiple email recipients
- Sudden-jump filtering to reject invalid readings
- Rate-limited logging
- One-shot alert notifications
- Automatic alert re-arming with hysteresis
- Debug logging for troubleshooting

---

## System Architecture

```text
Digital Scale
      │
      ▼
 MAX3232 RS232 Converter
      │
      ▼
    ESP32
      │
      ▼
Google Apps Script Webhook
      │
      ▼
Google Sheet
├── Sheet1 (data)
├── Config (settings)
└── Debug (optional logs)
```

The ESP32 reads weight data from the scale and sends it to a Google Apps Script web endpoint. The Apps Script validates the data, logs measurements to Google Sheets, and sends Gmail alerts when the weight crosses below a configured threshold.

---

## Repository Structure

### `Full_LN_Dewar_Tracking.ino`

Main ESP32 firmware.

Responsibilities:

- Connects to Wi-Fi
- Reads serial output from the scale
- Parses weight measurements
- Sends data to the Google Apps Script web endpoint

### `ESP_Logger.gs`

Google Apps Script backend.

Responsibilities:

- Receives data from the ESP32
- Validates incoming packets
- Filters sudden weight jumps
- Logs measurements to Google Sheets
- Reads configuration values from the Config sheet
- Sends Gmail notifications
- Implements alert rate limiting and re-arming logic

### `ESP32MacAddress.ino`

Utility sketch used during initial setup.

Responsibilities:

- Prints the ESP32 MAC address to the Serial Monitor
- Used when registering the ESP32 on the University of Michigan MSetup network

---

## Hardware Requirements

- ESP32 Development Board
- Digital Scale with RS-232 output
- MAX3232 RS-232 to TTL converter
- RS-232 cable
- USB cable for ESP32 programming
- Liquid nitrogen dewar

---

## Google Sheet Setup

Create a Google Sheet with the following tabs.

### Sheet1

Stores logged measurements.

| Column | Description |
|----------|-------------|
| A | Timestamp |
| B | Stability Status |
| C | Weight |
| D | Units |

### Config

Stores system configuration values.

Example:

| Setting | Value |
|----------|----------|
| WEIGHT_THRESHOLD | 35 |
| MAX_JUMP | 2 |
| MIN_INTERVAL_MS | 900000 |
| RECIPIENT_EMAILS | user1@umich.edu,user2@umich.edu |
| RESET_MARGIN | 0.3 |
| BCC_EMAIL | user@umich.edu |

#### Setting Descriptions

| Setting | Description |
|----------|-------------|
| WEIGHT_THRESHOLD | Alert threshold in pounds |
| MAX_JUMP | Maximum allowed change between consecutive readings |
| MIN_INTERVAL_MS | Minimum logging interval in milliseconds |
| RECIPIENT_EMAILS | Comma-separated list of Gmail recipients |
| RESET_MARGIN | Margin above threshold required to re-arm alerts |
| BCC_EMAIL | Optional BCC recipient |

### Debug

Optional debugging sheet used by the Apps Script when debugging is enabled.

---

## ESP32 Setup

### 1. Register ESP32 on MSetup

Before connecting to the University of Michigan network:

1. Upload `ESP32MacAddress.ino`
2. Open the Serial Monitor
3. Record the ESP32 MAC address
4. Connect to the MSetup network
5. Register the device using the MAC address
6. Confirm the device appears under "Manage Devices"

After registration, the ESP32 should connect automatically.

### 2. Wire the Hardware

Connect:

```text
Scale RS232
     │
     ▼
 MAX3232
     │
     ▼
   ESP32
```

Configure the scale to continuously output serial weight data.

### 3. Upload Firmware

1. Open `Full_LN_Dewar_Tracking.ino`
2. Update Wi-Fi credentials if needed
3. Insert the Apps Script Web App URL
4. Upload the sketch to the ESP32

---

## Google Apps Script Deployment

1. Open the Google Sheet
2. Navigate to:

   Extensions → Apps Script

3. Create a new script project
4. Copy the contents of `ESP_Logger.gs`
5. Save the project
6. Deploy as a Web App

### Deployment Settings

- Execute as: Me
- Access: Anyone

7. Authorize required permissions
8. Copy the generated Web App URL
9. Paste the URL into `Full_LN_Dewar_Tracking.ino`

---

## Accepted Packet Format

The Apps Script accepts only packets matching:

```text
ST,GS,+0039.64lb
```

Examples:

```text
ST,GS,+0039.64lb
ST,GS,+0040.12lb
ST,GS,+0035.50lb
```

Packets not matching this format are rejected.

---

## Data Validation

### Sudden Jump Filter

Readings are rejected if:

```text
|Current Weight - Previous Weight| > MAX_JUMP
```

This helps eliminate corrupted serial packets or scale glitches.

### Logging Rate Limit

Valid readings are only logged if:

```text
Time since last logged reading ≥ MIN_INTERVAL_MS
```

This prevents excessive spreadsheet writes.

---

## Alert Logic

An alert is sent only when the weight crosses downward through the threshold.

Condition:

```text
Previous Weight ≥ Threshold
Current Weight  < Threshold
```

Example:

```text
Threshold = 35 lb

36.2 lb  → 35.8 lb → 34.9 lb
                      ↑ Alert Sent
```

### One-Shot Alerts

After an alert is sent:

- Additional alerts are suppressed
- The system waits for the dewar to be refilled

### Automatic Re-Arming

Alerts become active again only when:

```text
Weight ≥ Threshold + RESET_MARGIN
```

Example:

```text
Threshold = 35 lb
Reset Margin = 0.3 lb

Re-arm level = 35.3 lb
```

This prevents repeated alerts caused by small fluctuations near the threshold.

---

## Gmail Notifications

When the threshold is crossed, recipients receive an email containing:

- Previous weight
- Current weight
- Alert threshold
- Timestamp
- Raw scale packet
- Link to the Google Sheet

Multiple recipients can be configured using:

```text
RECIPIENT_EMAILS
```

in the Config sheet.

---

## Troubleshooting

### No Data Appears in Google Sheets

Check:

- ESP32 is connected to Wi-Fi
- Web App URL is correct
- Apps Script is deployed
- Apps Script permissions are authorized

### No Alerts Are Sent

Check:

- RECIPIENT_EMAILS contains valid addresses
- WEIGHT_THRESHOLD is configured correctly
- Weight actually crossed below the threshold
- Gmail quota has not been exceeded

### Sudden Readings Are Rejected

Check:

- Scale serial output
- RS-232 wiring
- MAX_JUMP value

### Debugging

Enable debugging by setting:

```javascript
var DEBUG_ENABLED = true;
```

The script will write diagnostic information to the Debug sheet.

---

## Author

**Ruhi Yusuf**

University of Michigan

Originally developed for automated liquid nitrogen dewar monitoring in the Quantum Engineering Lab.
