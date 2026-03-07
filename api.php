<?php
// api.php - SENTINEL CORE BACKEND
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

$ADMIN_PW = "admin123"; // CHANGE THIS TO YOUR PASSWORD

// 1. DATABASE INITIALIZATION (SQLite)
$dbFile = __DIR__ . '/sentinel.sqlite';
$pdo = new PDO("sqlite:" . $dbFile);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Auto-create table if it doesn't exist
$pdo->exec("CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip TEXT, city TEXT, region TEXT, country TEXT, isp TEXT,
    lat REAL, lon REAL, ua TEXT, device TEXT, platform TEXT, 
    browser TEXT, page TEXT, screen TEXT
)");

$action = $_GET['action'] ?? '';

// Helper: Parse User Agent
function parseUA($ua) {
    $device = "Desktop Station"; $platform = "Unknown OS"; $browser = "Unknown Browser";
    if (!$ua) return [$device, $platform, $browser];

    if (preg_match('/mobile/i', $ua)) $device = "Mobile Unit";
    elseif (preg_match('/tablet/i', $ua)) $device = "Tablet Unit";
    
    if (preg_match('/Windows/i', $ua)) $platform = "Windows Core";
    elseif (preg_match('/iPhone|iPad|iPod/i', $ua)) $platform = "iOS Node";
    elseif (preg_match('/Android/i', $ua)) $platform = "Android Mesh";
    elseif (preg_match('/Macintosh|Mac OS/i', $ua)) $platform = "MacOS Kernel";
    elseif (preg_match('/Linux/i', $ua)) $platform = "Linux System";

    if (preg_match('/Edg/i', $ua)) $browser = "Edge";
    elseif (preg_match('/OPR|Opera/i', $ua)) $browser = "Opera";
    elseif (preg_match('/Chrome/i', $ua)) $browser = "Chrome";
    elseif (preg_match('/Safari/i', $ua) && !preg_match('/Chrome/i', $ua)) $browser = "Safari";
    elseif (preg_match('/Firefox/i', $ua)) $browser = "Firefox";

    return [$device, $platform, $browser];
}

// ---------------------------------------------------------
// ROUTE: POST INGESTION (Replaces app.post('/log'))
// ---------------------------------------------------------
if ($action === 'log' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
    $cleanIp = trim(explode(',', $ip)[0]);
    
    $isLocal = in_array($cleanIp,['127.0.0.1', '::1']) || strpos($cleanIp, '192.168.') === 0 || strpos($cleanIp, '10.') === 0;
    
    $geo =['city' => 'Void', 'regionName' => 'Void', 'country' => 'Void', 'isp' => 'Dark Web', 'lat' => null, 'lon' => null];
    if (!$isLocal) {
        $geoJson = @file_get_contents("http://ip-api.com/json/{$cleanIp}");
        if ($geoJson) {
            $parsedGeo = json_decode($geoJson, true);
            if ($parsedGeo && isset($parsedGeo['status']) && $parsedGeo['status'] === 'success') {
                $geo = array_merge($geo, $parsedGeo);
            }
        }
    } else {
        $geo =['city' => 'Localhost', 'regionName' => 'LAN', 'country' => 'Internal Matrix', 'isp' => 'Local Network', 'lat' => 0, 'lon' => 0];
    }

    list($device, $platform, $browser) = parseUA($input['ua'] ?? '');

    $stmt = $pdo->prepare("INSERT INTO logs (ip, city, region, country, isp, lat, lon, ua, device, platform, browser, page, screen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $cleanIp, $geo['city'], $geo['regionName'], $geo['country'], $geo['isp'], 
        $geo['lat'], $geo['lon'], $input['ua'] ?? '', $device, $platform, $browser, 
        $input['page'] ?? 'Root', $input['screen'] ?? 'Unknown'
    ]);

    echo "DATA INGESTED";
    exit;
}

// ---------------------------------------------------------
// ROUTE: GET RADAR/TELEMETRY
// ---------------------------------------------------------
if ($action === 'radar' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json');
    if (($_GET['pw'] ?? '') !== $ADMIN_PW) {
        http_response_code(401);
        echo json_encode(["error" => "ACCESS DENIED"]);
        exit;
    }

    // Build dynamic SQL where clauses
    $where = ["1=1"]; $params = [];
    if (!empty($_GET['search'])) {
        $where[] = "(ip LIKE ? OR isp LIKE ? OR city LIKE ? OR country LIKE ?)";
        $s = "%" . $_GET['search'] . "%";
        array_push($params, $s, $s, $s, $s);
    }
    if (!empty($_GET['device']) && $_GET['device'] !== 'ALL') { $where[] = "device = ?"; $params[] = $_GET['device']; }
    if (!empty($_GET['platform']) && $_GET['platform'] !== 'ALL') { $where[] = "platform = ?"; $params[] = $_GET['platform']; }
    if (!empty($_GET['browser']) && $_GET['browser'] !== 'ALL') { $where[] = "browser = ?"; $params[] = $_GET['browser']; }

    $whereSql = implode(" AND ", $where);

    try {
        // Logs
        $stmt = $pdo->prepare("SELECT * FROM logs WHERE $whereSql ORDER BY timestamp DESC LIMIT 100");
        $stmt->execute($params);
        $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Stats
        $stmt = $pdo->prepare("SELECT COUNT(*) as c FROM logs WHERE $whereSql");
        $stmt->execute($params);
        $totalHits = $stmt->fetchColumn();

        $stmt = $pdo->prepare("SELECT COUNT(DISTINCT ip) as c FROM logs WHERE $whereSql");
        $stmt->execute($params);
        $uniqueIPs = $stmt->fetchColumn();

        // Aggregations
        function getAgg($pdo, $col, $whereSql, $params, $limit = null) {
            $l = $limit ? "LIMIT $limit" : "";
            $stmt = $pdo->prepare("SELECT IFNULL($col, 'Unknown') as _id, COUNT(*) as count FROM logs WHERE $whereSql GROUP BY $col ORDER BY count DESC $l");
            $stmt->execute($params);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }

        $devices = getAgg($pdo, 'device', $whereSql, $params);
        $platforms = getAgg($pdo, 'platform', $whereSql, $params);
        $browsers = getAgg($pdo, 'browser', $whereSql, $params);
        
        $stmt = $pdo->prepare("SELECT city, country, COUNT(*) as count FROM logs WHERE $whereSql GROUP BY city, country ORDER BY count DESC LIMIT 5");
        $stmt->execute($params);
        $locationsRaw = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $locations = array_map(function($loc) {
            return ['_id' =>['city' => $loc['city'], 'country' => $loc['country']], 'count' => $loc['count']];
        }, $locationsRaw);

        $stmt = $pdo->prepare("SELECT DATE(timestamp) as _id, COUNT(*) as count FROM logs WHERE $whereSql AND timestamp >= datetime('now', '-7 days') GROUP BY DATE(timestamp) ORDER BY _id ASC");
        $stmt->execute($params);
        $timeline = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode([
            "logs" => $logs, 
            "stats" =>["totalHits" => $totalHits, "uniqueIPs" => $uniqueIPs, "devices" => $devices, "platforms" => $platforms, "browsers" => $browsers, "locations" => $locations, "timeline" => $timeline]
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(["error" => "SYSTEM CRASH: " . $e->getMessage()]);
    }
    exit;
}

// ---------------------------------------------------------
// ROUTE: HEALTH CHECK
// ---------------------------------------------------------
if ($action === 'health' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json');
    
    $status =[
        'analytics' => 'ONLINE',
        'database' => $pdo ? 'ONLINE' : 'OFFLINE',
        'mainSite' => 'OFFLINE',
        'checkIns' => 'OFFLINE'
    ];

    $ctx = stream_context_create(['http' => ['timeout' => 5]]);
    if (@file_get_contents('https://letrollologist.github.io/anya.github.io/index.html', false, $ctx) !== false) $status['mainSite'] = 'ONLINE';
    
    $headers = @get_headers('https://overdefensively-unabjective-eilene.ngrok-free.dev/');
    if ($headers && strpos($headers[0], '200') !== false) $status['checkIns'] = 'ONLINE';

    echo json_encode($status);
    exit;
}

// 404 Fallback
http_response_code(404);
echo "ENDPOINT NOT FOUND";
?>
