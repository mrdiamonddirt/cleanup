import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
    MapContainer,
    ImageOverlay,
    Marker,
    Popup,
    useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";

// --- LEAFLET ICON FIX ---
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
let DefaultIcon = L.icon({
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;
// ------------------------

const bounds = [
    [0, 0],
    [830, 1687],
];

const getIcon = (type, isRecovered) => {
    if (isRecovered)
        return L.divIcon({
            className: "icon-recovered",
            html: "✅",
            iconSize: [25, 25],
        });

    const colors = {
        trolley: "#e74c3c", // Red
        bike: "#3498db", // Blue
        other: "#f1c40f", // Yellow
    };

    return L.divIcon({
        className: "custom-pin",
        html: `<div style="background-color: ${colors[type] || "#888"}; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white;"></div>`,
        iconSize: [15, 15],
    });
};

function App() {
    const [items, setItems] = useState([]);

    useEffect(() => {
        fetchItems();
    }, []);

    async function fetchItems() {
        const { data, error } = await supabase.from("items").select("*");
        if (!error) setItems(data);
    }

    // Click handler to add new items to SQL
    function MapEvents() {
        useMapEvents({
            click: async (e) => {
                const type = prompt(
                    "Item type (trolley, bike, other)?",
                    "trolley",
                );
                if (!type) return;

                const { error } = await supabase
                    .from("items")
                    .insert([{ y: e.latlng.lat, x: e.latlng.lng, type: type }]);

                if (!error) fetchItems();
            },
        });
        return null;
    }

    return (
        <div
            style={{
                padding: "10px",
                fontFamily: "sans-serif",
                maxWidth: "1200px",
                margin: "0 auto",
            }}
        >
            <h1 style={{ fontSize: "1.5rem", marginBottom: "5px" }}>
                🌊 River Cleanup
            </h1>
            <p style={{ fontSize: "0.9rem", color: "#555" }}>
                Tap map to log. Tap marker to clear.
            </p>

            {/* Responsive Stats Box */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap", // Allows boxes to stack on small screens
                    gap: "10px",
                    marginBottom: "15px",
                    padding: "10px",
                    background: "#f8f9fa",
                    borderRadius: "8px",
                    border: "1px solid #ddd",
                    fontSize: "0.85rem",
                }}
            >
                <div style={{ flex: "1 1 100px" }}>
                    Total: <strong>{items.length}</strong>
                </div>
                <div style={{ flex: "1 1 100px" }}>
                    Recovered:{" "}
                    <strong style={{ color: "green" }}>
                        {items.filter((i) => i.is_recovered).length}
                    </strong>
                </div>
                <div style={{ flex: "1 1 100px" }}>
                    Remaining:{" "}
                    <strong style={{ color: "red" }}>
                        {items.filter((i) => !i.is_recovered).length}
                    </strong>
                </div>
            </div>

            <MapContainer
                crs={L.CRS.Simple}
                bounds={bounds}
                // Add these two for better mobile touch:
                tap={true}
                touchZoom={true}
                style={{
                    height: "calc(100vh - 250px)", // Dynamic height based on screen size
                    minHeight: "400px",
                    width: "100%",
                    border: "2px solid #333",
                    borderRadius: "12px", // Rounded corners look better on mobile
                    zIndex: 0,
                }}
            >
                <ImageOverlay url="/river-photo.jpg" bounds={bounds} />
                <MapEvents />

                {items.map((item) => (
                    <Marker
                        key={item.id}
                        position={[item.y, item.x]}
                        icon={getIcon(item.type, item.is_recovered)}
                    >
                        <Popup autoPanPadding={[50, 50]}>
                            <div
                                style={{
                                    textAlign: "center",
                                    minWidth: "120px",
                                }}
                            >
                                <strong style={{ fontSize: "1.1em" }}>
                                    {item.type.toUpperCase()}
                                </strong>
                                <p
                                    style={{
                                        fontSize: "0.8em",
                                        margin: "5px 0",
                                    }}
                                >
                                    {new Date(
                                        item.created_at,
                                    ).toLocaleDateString()}
                                </p>
                                <hr />
                                {!item.is_recovered ? (
                                    <button
                                        style={{
                                            marginTop: "8px",
                                            padding: "8px 12px",
                                            backgroundColor: "#2ecc71",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "4px",
                                            fontWeight: "bold",
                                            width: "100%", // Easier to tap on mobile
                                        }}
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            await supabase
                                                .from("items")
                                                .update({ is_recovered: true })
                                                .eq("id", item.id);
                                            fetchItems();
                                        }}
                                    >
                                        Recovered
                                    </button>
                                ) : (
                                    <span
                                        style={{
                                            color: "green",
                                            fontWeight: "bold",
                                        }}
                                    >
                                        CLEARED ✅
                                    </span>
                                )}
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
