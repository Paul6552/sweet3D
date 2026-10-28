package de.sweet3d;

import io.quarkus.vertx.web.RouteFilter;
import io.vertx.ext.web.RoutingContext;

/**
 * Liefert für Routen des React-Frontends (z. B. /editor/...) die index.html aus,
 * damit Deep-Links und herausgelöste Panel-Fenster auch nach einem Neuladen funktionieren.
 */
public class SpaFallback {

    @RouteFilter(100)
    void rerouteFrontendRoutes(RoutingContext context) {
        String path = context.normalizedPath();
        if (path.equals("/projects") || path.startsWith("/editor/")) {
            context.reroute("/index.html");
            return;
        }
        context.next();
    }
}
