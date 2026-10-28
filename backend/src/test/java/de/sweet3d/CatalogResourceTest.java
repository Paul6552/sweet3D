package de.sweet3d;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.startsWith;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

@QuarkusTest
class CatalogResourceTest {

    @Test
    void servesLocalizedFurnitureCatalogWithoutLogin() {
        given().header("Accept-Language", "de-DE,de;q=0.9")
                .when().get("/api/catalog/furniture")
                .then().statusCode(200)
                .body("language", equalTo("de"))
                .body("categories.size()", greaterThan(0))
                .body("categories.flatten().pieces.flatten().find { it.id == 'eTeks#bath' }.name", equalTo("Badewanne"))
                .body("categories[0].pieces[0].model", startsWith("/api/catalog/resource/com/eteks/sweethome3d/io/resources/"));

        given().when().get("/api/catalog/furniture?lang=en")
                .then().statusCode(200)
                .body("categories.flatten().pieces.flatten().find { it.id == 'eTeks#bath' }.name", equalTo("Bath"));
    }

    @Test
    void servesTexturesCatalog() {
        given().when().get("/api/catalog/textures?lang=de")
                .then().statusCode(200).body("categories.size()", greaterThan(0));
    }

    @Test
    void servesModelResources() {
        String model = given().when().get("/api/catalog/furniture?lang=en")
                .then().extract().path("categories[0].pieces[0].model");
        given().when().get(model).then().statusCode(200).header("Cache-Control", containsString("max-age=86400"));
    }

    @Test
    void servesDefaultObjMaterials() {
        given().when().get("/api/catalog/default-materials.mtl")
                .then().statusCode(200).body(containsString("newmtl white"));
    }

    @Test
    void refusesResourcesOutsideCatalog() {
        given().when().get("/api/catalog/resource/application.properties").then().statusCode(404);
        given().when().get("/api/catalog/resource/com/eteks/sweethome3d/io/resources/../DefaultFurnitureCatalog.properties")
                .then().statusCode(404);
    }
}
