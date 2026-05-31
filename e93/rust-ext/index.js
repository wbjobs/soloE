const {
  loadOsmPbf,
  isGraphLoaded,
  getNodeCount,
  getEdgeCount,
  planRoute,
  snapToRoad,
  generateTrip,
  addCongestionZone,
  removeCongestionZone,
  clearCongestionZones,
  getCongestionZones,
} = require('./osm-route-rs');

module.exports = {
  loadOsmPbf,
  isGraphLoaded,
  getNodeCount,
  getEdgeCount,
  planRoute,
  snapToRoad,
  generateTrip,
  addCongestionZone,
  removeCongestionZone,
  clearCongestionZones,
  getCongestionZones,
};
