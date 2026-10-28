package de.sweet3d;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import de.sweet3d.project.Project;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.restassured.http.ContentType;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

@QuarkusTest
class ProjectResourceTest {

    @Test
    void rejectsAnonymousAccess() {
        given().when().get("/api/projects").then().statusCode(401);
    }

    @Test
    @TestSecurity(user = "alice")
    void createsUpdatesAndDeletesProject() {
        String id = given().contentType(ContentType.JSON).body(Map.of("name", "Mein Haus"))
                .when().post("/api/projects")
                .then().statusCode(201).body("name", equalTo("Mein Haus")).body("version", equalTo(0))
                .extract().path("id");

        given().when().get("/api/projects").then().statusCode(200).body("id", hasItem(id));

        given().contentType(ContentType.JSON)
                .body(Map.of("name", "Umbenannt", "home", Map.of("walls", List.of()), "version", 0))
                .when().put("/api/projects/" + id)
                .then().statusCode(200).body("name", equalTo("Umbenannt")).body("version", equalTo(1));

        // Veralteter Stand wird abgelehnt
        given().contentType(ContentType.JSON).body(Map.of("name", "Konflikt", "version", 0))
                .when().put("/api/projects/" + id)
                .then().statusCode(409);

        given().when().get("/api/projects/" + id).then().statusCode(200).body("home.walls.size()", equalTo(0));

        given().when().delete("/api/projects/" + id).then().statusCode(204);
        given().when().get("/api/projects/" + id).then().statusCode(404);
    }

    @Test
    @TestSecurity(user = "bob")
    void projectsAreIsolatedBetweenUsers() {
        UUID id = QuarkusTransaction.requiringNew().call(() -> {
            Project project = new Project();
            project.id = UUID.randomUUID();
            project.ownerSub = "alice";
            project.name = "Alices Haus";
            project.home = JsonNodeFactory.instance.objectNode();
            project.createdAt = Instant.now();
            project.updatedAt = project.createdAt;
            project.persist();
            return project.id;
        });

        // Bob sieht Alices Projekt weder in der Liste noch direkt
        given().when().get("/api/projects").then().statusCode(200).body("id", not(hasItem(id.toString())));
        given().when().get("/api/projects/" + id).then().statusCode(404);
        given().contentType(ContentType.JSON).body(Map.of("name", "Gekapert", "version", 0))
                .when().put("/api/projects/" + id).then().statusCode(404);
        given().when().delete("/api/projects/" + id).then().statusCode(404);
    }
}
