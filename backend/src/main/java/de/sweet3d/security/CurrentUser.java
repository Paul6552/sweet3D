package de.sweet3d.security;

import io.quarkus.security.UnauthorizedException;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;

/**
 * Liefert die stabile Kennung (Token-Subject) des angemeldeten Nutzers.
 */
@RequestScoped
public class CurrentUser {

    @Inject
    SecurityIdentity identity;

    public String subject() {
        if (identity.isAnonymous()) {
            throw new UnauthorizedException();
        }
        return identity.getPrincipal().getName();
    }
}
