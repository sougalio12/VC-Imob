import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260915020000_property_client_experience.sql", "utf8");
const properties = readFileSync("crm/js/properties.js", "utf8");
const portal = readFileSync("js/client-selection.js", "utf8");
const page = readFileSync("selecao.html", "utf8");
const hardening = readFileSync("supabase/migrations/20260915040000_property_client_hardening.sql", "utf8");
const agenda = readFileSync("crm/js/agenda.js", "utf8");
const headers = readFileSync("_headers", "utf8");

test("property/client schema is append-only and tenant scoped", () => {
  for (const table of ["property_change_history", "property_drafts", "client_selections", "client_selection_items", "client_feedback", "post_visit_feedback"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
  }
  assert.doesNotMatch(migration, /disable row level security|service_role/i);
});

test("private selection tokens are strong, hashed, expiring and revocable", () => {
  assert.match(migration, /encode\(gen_random_bytes\(32\),'hex'\)/);
  assert.match(migration, /extensions\.digest\(raw_token,'sha256'\)/);
  assert.match(migration, /revoked_at is null and s\.expires_at>now\(\)/);
  assert.match(migration, /grant execute on function public\.get_client_selection\(text\).*anon,authenticated/s);
  assert.doesNotMatch(migration, /grant select on public\.client_selections to anon/i);
});

test("portal exposes only published properties and limited feedback", () => {
  assert.match(migration, /p\.is_published/);
  assert.match(migration, /target_reaction not in \('liked','maybe','disliked','visit_requested'\)/);
  assert.match(portal, /submit_client_feedback/);
  assert.match(page, /noindex,nofollow,noarchive/);
  assert.match(page, /name="referrer" content="no-referrer"/);
  assert.match(headers, /\/selecao\.html[\s\S]*Cache-Control: no-store, private/);
  assert.doesNotMatch(portal, /innerHTML|service_role|localStorage|sessionStorage/);
});

test("property 2.0 includes safe duplication, history, draft recovery and publish validation", () => {
  assert.match(migration, /duplicate_crm_property/);
  assert.match(migration, /'draft',false,false/);
  assert.match(migration, /record_property_history/);
  assert.match(properties, /Continuar o cadastro anterior/);
  assert.match(properties, /propertyPublicationRequirements/);
  assert.match(properties, /Imóvel parado/);
  assert.match(properties, /Conversão visita → proposta/);
  assert.match(properties, /Leads interessados/);
  assert.match(properties, /As imagens originais não foram alteradas/);
});

test("duplicate detection and post-visit feedback stay behind secured RPCs", () => {
  assert.match(migration, /find_duplicate_leads/);
  assert.match(migration, /save_post_visit_feedback/);
  assert.match(migration, /public\.can_access_lead/);
  assert.match(migration, /'save_post_visit_feedback\(uuid,uuid,uuid,text,text\[\],text,boolean,text,text\)'/);
  assert.match(migration, /revoke all on function public\.%s from public,anon,authenticated/);
});

test("publishing has preview plus backend-enforced minimum requirements", () => {
  assert.match(properties, /Revisão antes de publicar/);
  assert.match(properties, /Confirmar e publicar/);
  assert.match(hardening, /CRM_PROPERTY_PUBLICATION_INCOMPLETE/);
  assert.match(hardening, /jsonb_array_length\(target_media\) = 0/);
});

test("selection ordering, favorites and professional share are functional", () => {
  assert.match(properties, /Ordem da seleção/);
  assert.match(properties, /Compartilhar no WhatsApp/);
  assert.match(properties, /Validade do link/);
  assert.match(properties, /revoke_client_selection/);
  assert.match(portal, /set_client_favorite/);
  assert.match(portal, /aria-pressed/);
  assert.match(hardening, /is_favorite boolean/);
});

test("completed visits expose structured post-visit feedback", () => {
  assert.match(agenda, /Registrar pós-visita/);
  assert.match(agenda, /save_post_visit_feedback/);
  assert.match(agenda, /Intenção de proposta/);
  assert.match(hardening, /post_visit_feedback_lengths_check/);
});
