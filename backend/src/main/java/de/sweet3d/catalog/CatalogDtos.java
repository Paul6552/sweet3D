package de.sweet3d.catalog;

import java.util.List;

public final class CatalogDtos {

    private CatalogDtos() {
    }

    public record FurnitureCatalog(String language, List<FurnitureCategory> categories) {
    }

    public record FurnitureCategory(String name, List<CatalogPiece> pieces) {
    }

    /**
     * Möbelstück aus dem Katalog. Maße in cm, Ressourcen als URL relativ zur API.
     * Die Felder entsprechen {@link com.eteks.sweethome3d.model.CatalogPieceOfFurniture}.
     */
    public record CatalogPiece(
            String id,
            String name,
            String description,
            String creator,
            List<String> tags,
            String icon,
            String planIcon,
            String model,
            float[][] modelRotation,
            float width,
            float depth,
            float height,
            float elevation,
            float dropOnTopElevation,
            boolean movable,
            boolean resizable,
            boolean deformable,
            boolean texturable,
            boolean horizontallyRotatable,
            boolean backFaceShown,
            Integer color,
            String staircaseCutOutShape,
            DoorOrWindow doorOrWindow) {
    }

    /** Zusatzdaten für Türen und Fenster, sonst {@code null}. */
    public record DoorOrWindow(
            float wallThickness,
            float wallDistance,
            boolean wallCutOutOnBothSides,
            boolean widthDepthDeformable,
            String cutOutShape,
            List<Sash> sashes) {
    }

    public record Sash(float xAxis, float yAxis, float width, float startAngle, float endAngle) {
    }

    public record TexturesCatalog(String language, List<TexturesCategory> categories) {
    }

    public record TexturesCategory(String name, List<CatalogTexture> textures) {
    }

    public record CatalogTexture(String id, String name, String creator, String image, String icon, float width, float height) {
    }
}
