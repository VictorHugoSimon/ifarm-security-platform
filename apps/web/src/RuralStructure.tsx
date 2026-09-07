import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type Organization = { id: string; name: string; legal_name?: string | null };
type Neighborhood = { id: string; organization_id: string; name: string; municipality?: string | null; state_code?: string | null };
type Property = { id: string; organization_id: string; neighborhood_id?: string | null; name: string; municipality?: string | null; state_code?: string | null };

function friendlyError(message?: string) {
  const value = message || '';
  if (value.includes('platform_admin_required')) return 'Somente um Admin iFarm pode criar uma organização.';
  if (value.includes('organization_admin_required')) return 'Seu perfil não administra esta organização.';
  if (value.includes('verified_email_required')) return 'Confirme seu e-mail antes de executar esta ação.';
  if (value.includes('neighborhood_scope_mismatch')) return 'O bairro selecionado não pertence à organização.';
  if (value.includes('invalid_state_code')) return 'Informe a UF com duas letras.';
  return 'Não foi possível concluir a operação.';
}

export function RuralStructure() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [orgName, setOrgName] = useState('');
  const [orgLegalName, setOrgLegalName] = useState('');

  const [neighborhoodOrg, setNeighborhoodOrg] = useState('');
  const [neighborhoodName, setNeighborhoodName] = useState('');
  const [neighborhoodCity, setNeighborhoodCity] = useState('');
  const [neighborhoodUf, setNeighborhoodUf] = useState('');

  const [propertyOrg, setPropertyOrg] = useState('');
  const [propertyNeighborhood, setPropertyNeighborhood] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
  const [propertyUf, setPropertyUf] = useState('');

  const propertyNeighborhoods = useMemo(
    () => neighborhoods.filter((item) => item.organization_id === propertyOrg),
    [neighborhoods, propertyOrg]
  );

  async function loadStructure() {
    const [orgResult, neighborhoodResult, propertyResult] = await Promise.all([
      neon.from('organizations').select('id,name,legal_name'),
      neon.from('neighborhoods').select('id,organization_id,name,municipality,state_code'),
      neon.from('properties').select('id,organization_id,neighborhood_id,name,municipality,state_code')
    ]);

    const firstError = orgResult.error || neighborhoodResult.error || propertyResult.error;
    if (firstError) {
      setMessage('Não foi possível carregar a estrutura autorizada.');
      return;
    }

    const orgRows = (orgResult.data || []) as Organization[];
    const neighborhoodRows = (neighborhoodResult.data || []) as Neighborhood[];
    const propertyRows = (propertyResult.data || []) as Property[];

    setOrganizations(orgRows);
    setNeighborhoods(neighborhoodRows);
    setProperties(propertyRows);
    setNeighborhoodOrg((current) => current || orgRows[0]?.id || '');
    setPropertyOrg((current) => current || orgRows[0]?.id || '');
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const result = await neon.rpc('create_organization', {
        p_name: orgName,
        p_legal_name: orgLegalName || null
      });
      if (result.error) return setMessage(friendlyError(result.error.message));
      setOrgName('');
      setOrgLegalName('');
      setMessage('Organização criada e auditada.');
      await loadStructure();
    } finally {
      setSaving(false);
    }
  }

  async function createNeighborhood(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const result = await neon.rpc('create_neighborhood', {
        p_organization_id: neighborhoodOrg,
        p_name: neighborhoodName,
        p_municipality: neighborhoodCity || null,
        p_state_code: neighborhoodUf || null
      });
      if (result.error) return setMessage(friendlyError(result.error.message));
      setNeighborhoodName('');
      setMessage('Bairro rural criado e auditado.');
      await loadStructure();
    } finally {
      setSaving(false);
    }
  }

  async function createProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const result = await neon.rpc('create_property', {
        p_organization_id: propertyOrg,
        p_neighborhood_id: propertyNeighborhood || null,
        p_name: propertyName,
        p_municipality: propertyCity || null,
        p_state_code: propertyUf || null
      });
      if (result.error) return setMessage(friendlyError(result.error.message));
      setPropertyName('');
      setMessage('Propriedade criada e auditada.');
      await loadStructure();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { void loadStructure(); }, []);

  return (
    <section className="structure-section">
      <div className="section-heading">
        <div><span className="eyebrow">SEC-010 / 011 / 012</span><h2>Estrutura Rural</h2></div>
        <div className="structure-counts"><span>{organizations.length} organizações</span><span>{neighborhoods.length} bairros</span><span>{properties.length} propriedades</span></div>
      </div>

      {message && <div className="structure-message">{message}</div>}

      <div className="structure-grid">
        <form className="structure-card" onSubmit={createOrganization}>
          <strong>1. Organização</strong>
          <p>Cadastro raiz do tenant. Restrito ao Admin iFarm.</p>
          <label>Nome<input required value={orgName} onChange={(e) => setOrgName(e.target.value)} /></label>
          <label>Razão social<input value={orgLegalName} onChange={(e) => setOrgLegalName(e.target.value)} /></label>
          <button className="primary" disabled={saving}>Criar organização</button>
        </form>

        <form className="structure-card" onSubmit={createNeighborhood}>
          <strong>2. Bairro rural</strong>
          <p>Camada comunitária para vias, acessos e equipamentos compartilhados.</p>
          <label>Organização<select required value={neighborhoodOrg} onChange={(e) => setNeighborhoodOrg(e.target.value)}><option value="">Selecione</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Nome<input required value={neighborhoodName} onChange={(e) => setNeighborhoodName(e.target.value)} /></label>
          <div className="field-row"><label>Município<input value={neighborhoodCity} onChange={(e) => setNeighborhoodCity(e.target.value)} /></label><label>UF<input maxLength={2} value={neighborhoodUf} onChange={(e) => setNeighborhoodUf(e.target.value.toUpperCase())} /></label></div>
          <button className="primary" disabled={saving || !neighborhoodOrg}>Criar bairro</button>
        </form>

        <form className="structure-card" onSubmit={createProperty}>
          <strong>3. Propriedade</strong>
          <p>Escopo privado. O vínculo com o bairro não concede acesso privado ao administrador comunitário.</p>
          <label>Organização<select required value={propertyOrg} onChange={(e) => { setPropertyOrg(e.target.value); setPropertyNeighborhood(''); }}><option value="">Selecione</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Bairro<select value={propertyNeighborhood} onChange={(e) => setPropertyNeighborhood(e.target.value)}><option value="">Sem bairro</option>{propertyNeighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Nome da propriedade<input required value={propertyName} onChange={(e) => setPropertyName(e.target.value)} /></label>
          <div className="field-row"><label>Município<input value={propertyCity} onChange={(e) => setPropertyCity(e.target.value)} /></label><label>UF<input maxLength={2} value={propertyUf} onChange={(e) => setPropertyUf(e.target.value.toUpperCase())} /></label></div>
          <button className="primary" disabled={saving || !propertyOrg}>Criar propriedade</button>
        </form>
      </div>
    </section>
  );
}
