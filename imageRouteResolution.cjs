const selectDefaultImageRoute = ({ routes = [], defaultRouteId = "", routeFamily = "" } = {}) => {
  const activeRoutes = routes.filter((route) => route?.isActive !== false);
  const family = String(routeFamily || "").trim();
  if (family) {
    const familyRoutes = activeRoutes.filter(
      (route) => String(route.routeFamily || route.modelFamily || "").trim() === family,
    );
    const familyDefault = familyRoutes.find((route) => route.isDefaultRoute === true);
    if (familyDefault) return familyDefault;
    if (familyRoutes.length) return familyRoutes[0];
  }

  const fallbackId = String(defaultRouteId || "").trim();
  return activeRoutes.find((route) => String(route.id || "").trim() === fallbackId) || activeRoutes[0] || null;
};

module.exports = { selectDefaultImageRoute };
