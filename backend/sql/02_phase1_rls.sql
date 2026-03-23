-- Row Level Security for Phase 1 tables (Supabase)
-- Run after 01_phase1_schema.sql

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

-- profiles: user sees own row
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- organizations: members only
CREATE POLICY "orgs_select_member" ON organizations
  FOR SELECT USING (
    id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- organization_members
CREATE POLICY "org_members_select" ON organization_members
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- invitations (optional: admins only — simplified: org members can see)
CREATE POLICY "invitations_select_org" ON invitations
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- clients
CREATE POLICY "clients_org_isolation" ON clients
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- client_baselines
CREATE POLICY "baselines_org_isolation" ON client_baselines
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE org_id IN (
        SELECT org_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  );

-- background_jobs
CREATE POLICY "jobs_org_isolation" ON background_jobs
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- competitors
CREATE POLICY "competitors_org_isolation" ON competitors
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE org_id IN (
        SELECT org_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  );
