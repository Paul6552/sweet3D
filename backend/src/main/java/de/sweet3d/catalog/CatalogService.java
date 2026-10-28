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
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
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
    private String defaultMaterials;
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
        defaultMaterials = readDefaultMaterials();
        FurnitureCatalog first = furniture.get(languages.getFirst());
        LOG.infof("Katalog geladen: %d Sprachen, %d Möbel", languages.size(),
                first.categories().stream().mapToInt(c -> c.pieces().size()).sum());
    }

    /**
     * Standard-Materialbibliothek für OBJ-Modelle (Wavefront/Java 3D, z. B. „white“), die viele
     * Katalogmodelle per usemtl ohne eigene MTL-Datei verwenden.
     */
    public String defaultMaterials() {
        return defaultMaterials;
    }

    /**
     * Liest die Konstante JAVA_3D_MATERIALS aus dem Konstantenpool von OBJLoader.class.
     * Die Klasse selbst lässt sich nicht laden, da sie von Java 3D abhängt.
     */
    private static String readDefaultMaterials() {
        String classFile = "com/eteks/sweethome3d/j3d/OBJLoader.class";
        try (InputStream raw = Thread.currentThread().getContextClassLoader().getResourceAsStream(classFile)) {
            if (raw == null) {
                throw new IOException(classFile + " nicht gefunden");
            }
            DataInputStream in = new DataInputStream(raw);
            in.readInt(); // magic
            in.readUnsignedShort(); // minor version
            in.readUnsignedShort(); // major version
            int count = in.readUnsignedShort();
            for (int i = 1; i < count; i++) {
                int tag = in.readUnsignedByte();
                switch (tag) {
                    case 1 -> { // Utf8
                        String value = in.readUTF();
                        if (value.startsWith("newmtl ")) {
                            return value;
                        }
                    }
                    case 3, 4, 9, 10, 11, 12, 17, 18 -> in.readInt();
                    case 5, 6 -> { // Long, Double belegen zwei Einträge
                        in.readLong();
                        i++;
                    }
                    case 7, 8, 16, 19, 20 -> in.readUnsignedShort();
                    case 15 -> {
                        in.readUnsignedByte();
                        in.readUnsignedShort();
                    }
                    default -> throw new IOException("Unbekannter Konstantentyp " + tag);
                }
            }
            throw new IOException("JAVA_3D_MATERIALS nicht gefunden");
        } catch (IOException e) {
            LOG.warn("Standard-Materialien aus OBJLoader nicht lesbar, Modelle erscheinen grau", e);
            return "";
        }
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
