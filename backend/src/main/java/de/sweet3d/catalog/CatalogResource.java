package de.sweet3d.catalog;

import de.sweet3d.catalog.CatalogDtos.FurnitureCatalog;
import de.sweet3d.catalog.CatalogDtos.TexturesCatalog;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;
import java.io.InputStream;
import java.net.URL;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Öffentlicher Katalog (keine Nutzerdaten): Möbel, Texturen und deren Modelle/Bilder.
 */
@Path("/api/catalog")
public class CatalogResource {

    private static final Map<String, String> CONTENT_TYPES = Map.of(
            "obj", "text/plain",
            "mtl", "text/plain",
            "png", "image/png",
            "jpg", "image/jpeg",
            "jpeg", "image/jpeg",
            "gif", "image/gif",
            "svg", "image/svg+xml");

    @Inject
    CatalogService catalogService;

    @GET
    @Path("/furniture")
    public FurnitureCatalog furniture(@QueryParam("lang") String lang, @Context HttpHeaders headers) {
        return catalogService.furniture(language(lang, headers));
    }

    @GET
    @Path("/textures")
    public TexturesCatalog textures(@QueryParam("lang") String lang, @Context HttpHeaders headers) {
        return catalogService.textures(language(lang, headers));
    }

    @GET
    @Path("/resource/{path: .+}")
    public Response resource(@PathParam("path") String path) {
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String contentType = CONTENT_TYPES.get(extension);
        if (contentType == null || !path.startsWith(CatalogService.RESOURCE_ROOT) || path.contains("..")) {
            throw new NotFoundException();
        }
        URL url = Thread.currentThread().getContextClassLoader().getResource(path);
        if (url == null) {
            throw new NotFoundException();
        }
        return Response.ok((jakarta.ws.rs.core.StreamingOutput) out -> {
            try (InputStream in = url.openStream()) {
                in.transferTo(out);
            }
        }, contentType).header(HttpHeaders.CACHE_CONTROL, "public, max-age=86400").build();
    }

    private String language(String lang, HttpHeaders headers) {
        return catalogService.resolveLanguage(lang != null ? List.of(Locale.of(lang)) : headers.getAcceptableLanguages());
    }
}
