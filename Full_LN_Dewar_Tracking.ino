#include <WiFi.h>
#include <HTTPClient.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"  // Disable brownout protection

// ====== USER SETTINGS ======
#define WIFI_SSID "MSetup"
#define WIFI_PASSWORD ""
const char SHEETS_URL[] = "https://script.google.com/macros/s/AKfycbzVk1gPAHoAXeqiOHblu0HzUF1PmwjJ-p1L-_rXB-UnVKzkHsk5bub01Op_nm_PTi9r/exec";
#define RXD2 16
#define TXD2 17
#define TEST_MODE false  // ✅ Set to true for simulation
// ===========================

void sendRawToGoogleSheets(const String& raw) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SHEETS_URL);
    http.addHeader("Content-Type", "application/json");

    String json = "{\"method\":\"append\",\"raw\":\"" + raw + "\"}";
    http.POST(json);
    http.end();
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);  // Disable brownout reset
  Serial.begin(115200);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print(F("Connecting to Wi-Fi"));
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(F("."));
    delay(300);
  }

  Serial.println(F("\nWiFi connected!"));
  Serial.println(WiFi.localIP());

  if (!TEST_MODE) {
    Serial2.begin(9600, SERIAL_8N1, RXD2, TXD2);
  }
}

void loop() {
#if TEST_MODE
  static String testInputs[] = {
    "ST,GS,+0004.90lb",
    "ST,GS,+0005.20lb",
    "ST,GS,+0006.00lb",
    "ST,GS,+0004.80lb",
    "ST,GS,+0002.50lb"
  };
  static int i = 0;

  if (i < sizeof(testInputs) / sizeof(testInputs[0])) {
    String raw = testInputs[i++];
    Serial.println("Simulating: " + raw);
    sendRawToGoogleSheets(raw);
    delay(3000);
  } else {
    Serial.println(F("✅ All test strings sent."));
    while (true) delay(1000);
  }

#else
  if (Serial2.available()) {
    String message = Serial2.readStringUntil('\n');
    message.trim();

    if (message.length() > 0) {
      Serial.println("Received: " + message);
      sendRawToGoogleSheets(message);
    }
  }

  delay(5000);
#endif
}
