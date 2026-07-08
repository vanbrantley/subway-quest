import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { stations, routeShapes } from "../utils/subwayData";

// Centered on NYC, zoomed to show the whole subway system
const INITIAL_REGION = {
  latitude: 40.7128,
  longitude: -73.94,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

export default function MapScreen() {
  // Computed once on mount, not on every re-render (e.g. every pan/zoom)
  const stationList = useMemo(() => Object.values(stations), []);
  const branchList = useMemo(() => Object.values(routeShapes).flat(), []);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={INITIAL_REGION}
      >
        {branchList.map((branch) => (
          <Polyline
            key={branch.branch_id}
            coordinates={branch.points.map(([lat, lon]) => ({
              latitude: lat,
              longitude: lon,
            }))}
            strokeColor={branch.color}
            strokeWidth={3}
          />
        ))}

        {stationList.map((station) => (
          <Marker
            key={station.stop_id}
            coordinate={{ latitude: station.lat, longitude: station.lon }}
            title={station.name}
            description={station.daytime_routes.join(" ")}
            tracksViewChanges={false}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: "100%",
    height: "100%",
  },
});