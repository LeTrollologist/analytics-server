<?php
/**
 * SENTINEL // RENDER KEEP-ALIVE SCRIPT
 * ---------------------------------------------------------
 * Runs via Cron Job every 5-10 minutes to prevent Render's
 * free tier from spinning down the Node.js server.
 */

// 1. SET YOUR RENDER URL HERE (The /api/health endpoint is perfect for this)
$target_url = "https://analytics-server-bdrm.onrender.com/api/health";

// Initialize cURL session
$ch = curl_init($target_url);

// Configure cURL options
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true); // Return response as a string
curl_setopt($ch, CURLOPT_HEADER, false);        // Exclude headers from output
curl_setopt($ch, CURLOPT_TIMEOUT, 15);          // 15 second timeout limit
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true); // Follow any redirects
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);// Prevent SSL errors on some strict PHP hosts
curl_setopt($ch, CURLOPT_USERAGENT, "Sentinel-KeepAlive-Bot/1.0"); // Custom User-Agent

// Execute the request
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);

curl_close($ch);

// Generate timestamp for logging
$timestamp = date("Y-m-d H:i:s");

// Output results (useful if you are logging cron outputs to a file)
if ($http_code >= 200 && $http_code < 300) {
    echo "[$timestamp] [SYSTEM UPLINK] SUCCESS: Pinged $target_url | Status Code: $http_code\n";
    // Optional: echo $response; // Will output the JSON from your health route
} else {
    echo "[$timestamp] [CRITICAL] FAILED: Could not reach $target_url | Status Code: $http_code | Error: $error\n";
}
?>
