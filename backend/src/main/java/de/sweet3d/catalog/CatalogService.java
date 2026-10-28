package de.sweet3d.catalog;

import com.eteks.sweethome3d.io.DefaultFurnitureCatalog;
import com.eteks.sweethome3d.io.DefaultTexturesCatalog;
import com.eteks.sweethome3d.model.CatalogDoorOrWindow;
import com.eteks.sweethome3d.model.CatalogPieceOfFurniture;
import com.eteks.sweethome3d.model.Content;
import com.eteks.sweethome3d.model.Library;
import com.eteks.sweethome3d.model.UserPreferences;
import com.eteks.sweethome3d.tools.URLContent;
import de.sweet3d.catalog.CatalogDtos.CatalogPiece;
import de.sweet3d.catalog.CatalogDtos.CatalogTexture;
import de.sweet3d.catalog.CatalogDtos.DoorOrWindow;
import de.sweet3d.catalog.CatalogDtos.FurnitureCatalog;
import de.sweet3d.catalog.CatalogDtos.FurnitureCategory;
import de.sweet3d.catalog.CatalogDtos.Sash;
import de.sweet3d.catalog.CatalogDtos.TexturesCatalog;
import de.sweet3d.catalog.CatalogDtos.TexturesCategory;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.File;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Stellt den Möbel- und Texturkatalog aus Furniture.jar und Textures.jar der
 * Sweet Home 3D Distribution bereit. Die Kataloge werden beim Start einmal je Sprache gelesen.
 */
@Startup
@ApplicationScoped
public class CatalogService {

    /** Präfix aller Katalog-Ressourcen im Klassenpfad; nur darunter wird ausgeliefert. */
    static final String RESOURCE_ROOT = "com/eteks/sweethome3d/io/resources/";
    static final String RESOURCE_URL_PREFIX = "/api/catalog/resource/";

    private static final Logger LOG = Logger.getLogger(CatalogService.class);

    @ConfigProperty(name = "sweet3d.catalog.languages")
    List<String> languages;

    private final Map<String, FurnitureCatalog> furniture = new HashMap<>();
    private final Map<String, TexturesCatalog> textures = new HashMap<>();

    @PostConstruct
    void load() {
        // UserPreferences.setLanguage ändert die globale Default-Locale, daher danach zurücksetzen
        Locale defaultLocale = Locale.getDefault();
        try {
            for (String language : languages) {
                UserPreferences preferences = new CatalogPreferences(language);
                furniture.put(language, toDto(language, new DefaultFurnitureCatalog(preferences, (File) null)));
                textures.put(language, toDto(language, new DefaultTexturesCatalog(preferences, (File) null)));
            }
        } finally {
            Locale.setDefault(defaultLocale);
        }
        FurnitureCatalog first = furniture.get(languages.getFirst());
        LOG.infof("Katalog geladen: %d Sprachen, %d Möbel", languages.size(),
                first.categories().stream().mapToInt(c -> c.pieces().size()).sum());
    }

    public FurnitureCatalog furniture(String language) {
        return furniture.getOrDefault(language, furniture.get(languages.getFirst()));
    }

    public TexturesCatalog textures(String language) {
        return textures.getOrDefault(language, textures.get(languages.getFirst()));
    }

    /** Wählt die erste unterstützte Sprache aus einer Liste bevorzugter Locales. */
    public String resolveLanguage(List<Locale> acceptable) {
        return acceptable.stream()
                .map(Locale::getLanguage)
                .filter(languages::contains)
                .findFirst()
                .orElse(languages.getFirst());
    }

    private static FurnitureCatalog toDto(String language, com.eteks.sweethome3d.model.FurnitureCatalog catalog) {
        return new FurnitureCatalog(language, catalog.getCategories().stream()
                .map(category -> new FurnitureCategory(category.getName(),
                        category.getFurniture().stream().map(CatalogService::toDto).toList()))
                .toList());
    }

    private static CatalogPiece toDto(CatalogPieceOfFurniture piece) {
        DoorOrWindow doorOrWindow = null;
        if (piece instanceof CatalogDoorOrWindow door) {
            doorOrWindow = new DoorOrWindow(door.getWallThickness(), door.getWallDistance(),
                    door.isWallCutOutOnBothSides(), door.isWidthDepthDeformable(), door.getCutOutShape(),
                    Arrays.stream(door.getSashes())
                            .map(s -> new Sash(s.getXAxis(), s.getYAxis(), s.getWidth(), s.getStartAngle(), s.getEndAngle()))
                            .toList());
        }
        return new CatalogPiece(piece.getId(), piece.getName(), piece.getDescription(), piece.getCreator(),
                piece.getTags() == null ? List.of() : List.of(piece.getTags()),
                resourceUrl(piece.getIcon()), resourceUrl(piece.getPlanIcon()), resourceUrl(piece.getModel()),
                piece.getModelRotation(), piece.getWidth(), piece.getDepth(), piece.getHeight(),
                piece.getElevation(), piece.getDropOnTopElevation(), piece.isMovable(), piece.isResizable(),
                piece.isDeformable(), piece.isTexturable(), piece.isHorizontallyRotatable(),
                piece.isBackFaceShown(), piece.getColor(), piece.getStaircaseCutOutShape(), doorOrWindow);
    }

    private static TexturesCatalog toDto(String language, com.eteks.sweethome3d.model.TexturesCatalog catalog) {
        return new TexturesCatalog(language, catalog.getCategories().stream()
                .map(category -> new TexturesCategory(category.getName(), category.getTextures().stream()
                        .map(t -> new CatalogTexture(t.getId(), t.getName(), t.getCreator(),
                                resourceUrl(t.getImage()), resourceUrl(t.getIcon()), t.getWidth(), t.getHeight()))
                        .toList()))
                .toList());
    }

    /** Wandelt eine Ressource aus einem Katalog-JAR in eine URL des Endpunkts /api/catalog/resource um. */
    static String resourceUrl(Content content) {
        if (!(content instanceof URLContent urlContent)) {
            return null;
        }
        String url = urlContent.getURL().toString();
        int index = url.indexOf(RESOURCE_ROOT);
        return index < 0 ? null : RESOURCE_URL_PREFIX + url.substring(index);
    }

    /** Minimale Einstellungen, die nur die Sprache für das Lesen der Kataloge festlegen. */
    private static final class CatalogPreferences extends UserPreferences {

        CatalogPreferences(String language) {
            setLanguage(language);
        }

        @Override
        public void write() {
        }

        @Override
        public void addLanguageLibrary(String location) {
        }

        @Override
        public boolean languageLibraryExists(String location) {
            return false;
        }

        @Override
        public void addFurnitureLibrary(String location) {
        }

        @Override
        public boolean furnitureLibraryExists(String location) {
            return false;
        }

        @Override
        public void addTexturesLibrary(String location) {
        }

        @Override
        public boolean texturesLibraryExists(String location) {
            return false;
        }

        @Override
        public List<Library> getLibraries() {
            return List.of();
        }
    }
}
