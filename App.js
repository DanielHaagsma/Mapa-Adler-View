import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  Linking,
} from "react-native";
import * as Location from "expo-location";
import WebView from "react-native-webview";
import { supabase } from "./supabase";

const toRadians = (value) => (value * Math.PI) / 180;

const calculateDistanceMeters = (origin, destination) => {
  const earthRadius = 6371000;
  const dLat = toRadians(destination.lat - origin.lat);
  const dLng = toRadians(destination.lng - origin.lng);
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const calculateBearing = (origin, destination) => {
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);
  const dLng = toRadians(destination.lng - origin.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  return (angle + 360) % 360;
};

const getCompassDirection = (bearing) => {
  const directions = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
};

const formatDistance = (meters) => {
  if (!Number.isFinite(meters)) return "--";
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
};

export default function App() {
  const [role, setRole] = useState("drone");
  const [activeAlert, setActiveAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState("inicializando");
  const [userPosition, setUserPosition] = useState({
    lat: -23.3105,
    lng: -51.3689,
  });

  const routeInfo =
    role === "seguranca" && activeAlert && userPosition
      ? {
          distanceMeters: calculateDistanceMeters(userPosition, {
            lat: activeAlert.latitude,
            lng: activeAlert.longitude,
          }),
          direction: getCompassDirection(
            calculateBearing(userPosition, {
              lat: activeAlert.latitude,
              lng: activeAlert.longitude,
            }),
          ),
        }
      : null;

  // Coordenadas centrais padrão (São Paulo)
  const [coords, setCoords] = useState({ lat: -23.3105, lng: -51.3689 });

  useEffect(() => {
    let mounted = true;

    const getUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          console.warn("Permissão de localização negada pelo usuário.");
          return;
        }

        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (!mounted) return;

        const nextCoords = {
          lat: currentPosition.coords.latitude,
          lng: currentPosition.coords.longitude,
        };

        setUserPosition(nextCoords);
        setCoords(nextCoords);
      } catch (error) {
        console.error("Erro ao obter localização do usuário:", error);
      }
    };

    getUserLocation();
    return () => {
      mounted = false;
    };
  }, []);

  // 1. ESCUTA EM TEMPO REAL DO SUPABASE
  useEffect(() => {
    if (role !== "seguranca") {
      setRealtimeStatus("desconectado (modo drone)");
      return;
    }

    setRealtimeStatus("conectando...");

    // Nome único com timestamp para evitar conflito de canais ativos
    const channelId = `guardview-realtime-${Date.now()}`;
    const canal = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ocorrencias",
        },
        (payload) => {
          const ocorrencia = payload.new;
          const lat = Number(ocorrencia.latitude);
          const lng = Number(ocorrencia.longitude);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            console.error("Coordenadas inválidas:", ocorrencia);
            return;
          }

          console.log("Alerta recebido via Realtime:", { lat, lng });

          setActiveAlert(ocorrencia);
          setCoords({ lat, lng });

          Alert.alert("🚨 ALERTA DO DRONE!", `Coordenadas: ${lat}, ${lng}`);
        },
      )
      .subscribe((status, error) => {
        console.log("Status do canal:", status, error ?? "");
        setRealtimeStatus(String(status));
      });

    return () => {
      supabase.removeChannel(canal);
    };
  }, [role]);

  // 2. GERAR HTML DO MAPA COM LEAFLET
  const generateMapHTML = () => {
    let markersHTML = "";

    if (role === "seguranca" && activeAlert && userPosition) {
      markersHTML += `
        var routeLine = L.polyline([
          [${userPosition.lat}, ${userPosition.lng}],
          [${activeAlert.latitude}, ${activeAlert.longitude}]
        ], {
          color: '#e74c3c',
          weight: 5,
          opacity: 0.8,
          dashArray: '12, 10'
        }).addTo(map);
        routeLine.bindPopup("Rota até o ponto do drone");
      `;
    }

    // Marker do drone (vermelho)
    if (role === "drone" && selectedPoint) {
      markersHTML += `
        var marker1 = L.marker([${selectedPoint.lat}, ${selectedPoint.lng}], {
          title: "📍 Ponto Selecionado",
          icon: L.divIcon({
            html: '<div style="background-color: #e74c3c; color: white; padding: 8px 12px; border-radius: 20px; font-weight: bold; font-size: 12px;">📍</div>',
            iconSize: [35, 35],
            className: 'custom-icon'
          })
        }).addTo(map);
        marker1.bindPopup("📍 Ponto Selecionado<br>Lat: ${selectedPoint.lat.toFixed(6)}<br>Lng: ${selectedPoint.lng.toFixed(6)}").openPopup();
      `;
    }

    // Marker de segurança (azul)
    if (role === "seguranca" && activeAlert) {
      markersHTML += `
        var marker2 = L.marker([${activeAlert.latitude}, ${activeAlert.longitude}], {
          title: "🚨 Alerta do Drone",
          icon: L.divIcon({
            html: '<div style="background-color: #2980b9; color: white; padding: 8px 12px; border-radius: 20px; font-weight: bold; font-size: 12px;">🚨</div>',
            iconSize: [35, 35],
            className: 'custom-icon'
          })
        }).addTo(map);
        marker2.bindPopup("🚨 Alerta do Drone<br>Lat: ${activeAlert.latitude.toFixed(6)}<br>Lng: ${activeAlert.longitude.toFixed(6)}").openPopup();
      `;
    }

    const centerLat =
      role === "drone" && selectedPoint
        ? selectedPoint.lat
        : role === "seguranca" && activeAlert
          ? activeAlert.latitude
          : coords.lat;
    const centerLng =
      role === "drone" && selectedPoint
        ? selectedPoint.lng
        : role === "seguranca" && activeAlert
          ? activeAlert.longitude
          : coords.lng;

    const routeFitBounds =
      role === "seguranca" && activeAlert && userPosition
        ? `map.fitBounds([[${userPosition.lat}, ${userPosition.lng}], [${activeAlert.latitude}, ${activeAlert.longitude}]], { padding: [40, 40] });`
        : "";

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
        <style>
          * { margin: 0; padding: 0; }
          body { height: 100vh; font-family: Arial, sans-serif; }
          #map { width: 100%; height: 100%; }
          .custom-icon { background: none !important; border: none !important; }
          .leaflet-popup-content { font-size: 12px; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: true, maxZoom: 20 }).setView([${centerLat}, ${centerLng}], 18);
          L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 20
          }).addTo(map);

          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              function(pos) {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                map.setView([lat, lng], 18, { animate: true });
              },
              function() {
                map.setView([${centerLat}, ${centerLng}], 18, { animate: true });
              },
              { enableHighAccuracy: true, timeout: 10000 }
            );
          }

          ${markersHTML}
          ${routeFitBounds}

          // Listener para cliques no mapa (apenas drone)
          ${
            role === "drone"
              ? `
            map.on('click', function(e) {
              const payload = JSON.stringify({
                type: 'mapClick',
                latitude: e.latlng.lat,
                longitude: e.latlng.lng
              });

              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(payload);
              } else {
                parent.postMessage(payload, '*');
              }
            });
          `
              : ""
          }
        </script>
      </body>
      </html>
    `;
  };

  // 3. HANDLER PARA CLIQUES NO MAPA (via postMessage)
  const handleMapMessage = (event) => {
    try {
      const rawData =
        typeof event?.nativeEvent?.data === "string"
          ? event.nativeEvent.data
          : typeof event?.data === "string"
            ? event.data
            : null;

      if (!rawData) return;

      const data = JSON.parse(rawData);
      if (data.type === "mapClick") {
        handleMapPress(data.latitude, data.longitude);
      }
    } catch (e) {
      // Ignorar mensagens de extensões do navegador ou React DevTools
    }
  };

  // 4. HANDLER PARA ENVIAR COORDENADAS (Drone)
  const handleMapPress = async (latitude, longitude) => {
    if (role !== "drone") return;

    // Armazenar ponto selecionado localmente
    setSelectedPoint({ lat: latitude, lng: longitude });

    // Enviar para Supabase
    setLoading(true);
    console.log(`[Drone] Enviando alerta: Lat ${latitude}, Lng ${longitude}`);

    try {
      const { error } = await supabase.from("ocorrencias").insert({
        latitude,
        longitude,
        tipo: "drone_alert",
      });

      setLoading(false);

      if (error) {
        console.error("Erro ao salvar no Supabase:", {
          message: error.message,

          code: error.code,

          details: error.details,

          hint: error.hint,
          error,
        });
        Alert.alert(
          "Erro",
          `Falha ao enviar: 
${error.message || "Falha de conexão com o Supabase"}
`,
        );

        return;
      }

      Alert.alert(
        "✅ Enviado",
        `Ponto enviado!\nLat: ${latitude.toFixed(4)}\nLng: ${longitude.toFixed(4)}`,
      );
    } catch (e) {
      setLoading(false);
      console.error("Erro ao salvar no Supabase:", e?.message ?? e);
      Alert.alert(
        "Erro",
        `Falha ao enviar: ${e?.message ?? "Falha de conexão com o Supabase"}`,
      );
    }
  };

  // 5. ESCUTAR MENSAGENS DO MAPA (Nativo + Web)
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.addEventListener("message", handleMapMessage);
      return () => window.removeEventListener("message", handleMapMessage);
    }
  }, [role]);

  return (
    <View style={styles.container}>
      {/* Menu Superior de Seleção de Modo */}
      <View style={styles.topMenu}>
        <Text style={styles.realtimeBadge}>Realtime: {realtimeStatus}</Text>
        <TouchableOpacity
          style={[
            styles.menuButton,
            role === "drone" && styles.activeDroneButton,
          ]}
          onPress={() => {
            setRole("drone");
            setActiveAlert(null);
          }}
        >
          <Text style={styles.menuText}>
            🤖 Modo Drone (Painel do Operador)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuButton,
            role === "seguranca" && styles.activeSecurityButton,
          ]}
          onPress={() => setRole("seguranca")}
        >
          <Text style={styles.menuText}>🛡️ Modo Segurança (Equipe de Rua)</Text>
        </TouchableOpacity>
      </View>

      {/* MAPA INTERATIVO */}
      <View style={styles.mapContainer}>
        {Platform.OS === "web" ? (
          typeof window !== "undefined" && (
            <iframe
              srcDoc={generateMapHTML()}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                borderRadius: 0,
              }}
              title="Mapa Interativo"
              sandbox="allow-scripts"
              allow="geolocation"
            />
          )
        ) : (
          <WebView
            source={{ html: generateMapHTML() }}
            onMessage={handleMapMessage}
            originWhitelist={["*"]}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            geolocationEnabled={true}
            allowsInlineMediaPlayback={true}
            style={styles.webview}
          />
        )}
      </View>

      {/* PAINEL DO SEGURANÇA: Exibe os dados recebidos via Realtime */}
      {role === "seguranca" && activeAlert && (
        <View style={styles.bottomPanel}>
          <Text style={[styles.panelTitle, { color: "#e74c3c" }]}>
            🚨 OCORRÊNCIA RECEBIDA AO VIVO!
          </Text>
          <Text style={styles.panelSubtitle}>
            <Text style={{ fontWeight: "bold" }}>Tipo:</Text> {activeAlert.tipo}
          </Text>
          <Text style={styles.panelSubtitle}>
            <Text style={{ fontWeight: "bold" }}>Latitude:</Text>{" "}
            {activeAlert.latitude.toFixed(6)}
          </Text>
          <Text style={styles.panelSubtitle}>
            <Text style={{ fontWeight: "bold" }}>Longitude:</Text>{" "}
            {activeAlert.longitude.toFixed(6)}
          </Text>
          {routeInfo && (
            <>
              <Text style={styles.panelSubtitle}>
                <Text style={{ fontWeight: "bold" }}>Distância:</Text>{" "}
                {formatDistance(routeInfo.distanceMeters)}
              </Text>
              <Text style={styles.panelSubtitle}>
                <Text style={{ fontWeight: "bold" }}>Direção:</Text>{" "}
                {routeInfo.direction}
              </Text>
            </>
          )}
          {(activeAlert.timestamp || activeAlert.created_at) && (
            <Text style={[styles.panelSubtitle, { fontSize: 11 }]}>
              <Text style={{ fontWeight: "bold" }}>Hora:</Text>{" "}
              {new Date(
                activeAlert.timestamp ?? activeAlert.created_at,
              ).toLocaleTimeString("pt-BR")}
            </Text>
          )}

          {routeInfo && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: "#16a085", marginTop: 6 },
              ]}
              onPress={() => {
                const destination = `${activeAlert.latitude},${activeAlert.longitude}`;
                const origin = `${userPosition.lat},${userPosition.lng}`;
                const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
                Linking.openURL(url);
              }}
            >
              <Text style={styles.actionButtonText}>🧭 Abrir rota no Maps</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: "#2ecc71", marginTop: 15 },
            ]}
            onPress={() => setActiveAlert(null)}
          >
            <Text style={styles.actionButtonText}>
              ✅ Chamado Atendido / Limpar Tela
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* PAINEL DO DRONE: Informações do ponto enviado */}
      {role === "drone" && selectedPoint && (
        <View style={styles.bottomPanel}>
          <Text style={[styles.panelTitle, { color: "#2c3e50" }]}>
            📍 PONTO ENVIADO
          </Text>
          <Text style={styles.panelSubtitle}>
            <Text style={{ fontWeight: "bold" }}>Latitude:</Text>{" "}
            {selectedPoint.lat.toFixed(6)}
          </Text>
          <Text style={styles.panelSubtitle}>
            <Text style={{ fontWeight: "bold" }}>Longitude:</Text>{" "}
            {selectedPoint.lng.toFixed(6)}
          </Text>
          <Text
            style={[styles.panelSubtitle, { fontSize: 12, color: "#27ae60" }]}
          >
            ✓ Transmitido em tempo real
          </Text>

          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: "#95a5a6", marginTop: 15 },
            ]}
            onPress={() => setSelectedPoint(null)}
          >
            <Text style={styles.actionButtonText}>Limpar Ponto</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  mapContainer: { flex: 1, marginTop: 110, width: "100%" },
  webview: {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
  },
  topMenu: {
    position: "absolute",
    top: 30,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    width: "100%",
    zIndex: 999,
  },
  realtimeBadge: {
    position: "absolute",
    top: -18,
    right: 15,
    color: "#2c3e50",
    fontSize: 10,
    fontWeight: "bold",
    backgroundColor: "rgba(255,255,255,0.8)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  menuButton: {
    flex: 1,
    backgroundColor: "#7f8c8d",
    padding: 14,
    marginHorizontal: 5,
    borderRadius: 10,
    alignItems: "center",
    cursor: "pointer",
  },
  activeDroneButton: { backgroundColor: "#2c3e50" },
  activeSecurityButton: { backgroundColor: "#2980b9" },
  menuText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 13,
    textAlign: "center",
  },
  bottomPanel: {
    position: "absolute",
    bottom: 30,
    left: "5%",
    right: "5%",
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 15,
    boxShadow: "0px 4px 10px rgba(0,0,0,0.1)",
    zIndex: 999,
  },
  panelTitle: {
    fontWeight: "bold",
    fontSize: 16,
    color: "#333",
    marginBottom: 2,
  },
  panelSubtitle: { fontSize: 13, color: "#7f8c8d", marginBottom: 12 },
  buttonRow: { flexDirection: "row", justifyContent: "space-between" },
  actionButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginHorizontal: 5,
    cursor: "pointer",
  },
  actionButtonText: { color: "#fff", fontWeight: "#bold", fontSize: 13 },
});
