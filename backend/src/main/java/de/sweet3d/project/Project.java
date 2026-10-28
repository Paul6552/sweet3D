package de.sweet3d.project;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Basic;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "project")
public class Project extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "owner_sub", nullable = false)
    public String ownerSub;

    @Column(nullable = false)
    public String name;

    /** Inhalt des Projekts (Wände, Räume, Möbel ...) im JSON-Format des Frontends. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Basic(fetch = FetchType.LAZY)
    @Column(nullable = false, columnDefinition = "jsonb")
    public JsonNode home;

    @Basic(fetch = FetchType.LAZY)
    public byte[] thumbnail;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    @Version
    public long version;

    public static List<Project> listByOwner(String ownerSub) {
        return list("ownerSub = ?1 order by updatedAt desc", ownerSub);
    }

    public static Optional<Project> findByIdAndOwner(UUID id, String ownerSub) {
        return find("id = ?1 and ownerSub = ?2", id, ownerSub).firstResultOptional();
    }
}
