import { FormEvent, useEffect, useMemo, useState } from 'react';
import { neon } from './lib/neon';

type Neighborhood = { id: string; organization_id: string; name: string };
type Property = { id: string; organization_id: string; neighborhood_id?: string | null; name: string };
type Area = { id: string; property_id: string; name: string; area_type?: string | null };
type Device = { id: string; name: string; device_type: string; status: string; community_shared: boolean };

const deviceTypes = ['camera','sensor','gateway','nvr','gps','siren','panic'];

function errorText(message?: string) {
  const value = message || '';
  if (value.includes('property_management_required')) return 'Seu perfil não pode gerenciar esta propriedade.';
  if (value.includes('neighborhood_management_required')) return 'Seu perfil não pode gerenciar este bairro.';
  if (value.includes('area_scope_mismatch')) return 'A área não pertence à propriedade selecionada.';
  if (value.includes('invalid_coordinates')) return 'Latitude ou longitude inválida.';
  if (value.includes('latitude_longitude_pair_required')) return 'Informe latitude e longitude juntas.';
  return 'Não foi possível concluir o cadastro.';
}

export function DeviceSetup() {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [areaProperty, setAreaProperty] = useState('');
  const [areaName, setAreaName] = useState('');
  const [areaType, setAreaType] = useState('critical');

  const [scope, setScope] = useState<'community'|'private'>('private');
  const [neighborhoodId, setNeighborhoodId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [deviceType, setDeviceType] = useState('camera');
  const [deviceName, setDeviceName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  const propertyAreas = useMemo(() => areas.filter((item) => item.property_id === propertyId), [areas, propertyId]);

  async function load() {
    const [n, p, a, d] = await Promise.all([
      neon.from('neighborhoods').select('id,organization_id,name'),
      neon.from('properties').select('id,organization_id,neighborhood_id,name'),
      neon.from('areas').select('id,property_id,name,area_type'),
      neon.from('devices').select('id,name,device_type,status,community_shared')
    ]);
    if (n.error || p.error || a.error || d.error) return setMessage('Não foi possível carregar áreas e dispositivos autorizados.');
    const nRows = (n.data || []) as Neighborhood[];
    const pRows = (p.data || []) as Property[];
    setNeighborhoods(nRows);
    setProperties(pRows);
    setAreas((a.data || []) as Area[]);
    setDevices((d.data || []) as Device[]);
    setNeighborhoodId((current) => current || nRows[0]?.id || '');
    setPropertyId((current) => current || pRows[0]?.id || '');
    setAreaProperty((current) => current || pRows[0]?.id || '');
  }

  async function createArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('create_area', { p_property_id: areaProperty, p_name: areaName, p_area_type: areaType || null, p_boundary_geojson: null });
      if (result.error) return setMessage(errorText(result.error.message));
      setAreaName(''); setMessage('Área privada criada e auditada.'); await load();
    } finally { setSaving(false); }
  }

  async function createDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      const result = await neon.rpc('register_device', {
        p_scope: scope,
        p_neighborhood_id: scope === 'community' ? neighborhoodId : null,
        p_property_id: scope === 'private' ? propertyId : null,
        p_area_id: scope === 'private' && areaId ? areaId : null,
        p_device_type: deviceType,
        p_name: deviceName,
        p_manufacturer: manufacturer || null,
        p_model: model || null,
        p_serial_number: serial || null,
        p_firmware_version: null,
        p_latitude: latitude === '' ? null : Number(latitude),
        p_longitude: longitude === '' ? null : Number(longitude)
      });
      if (result.error) return setMessage(errorText(result.error.message));
      setDeviceName(''); setSerial(''); setMessage('Dispositivo registrado offline e auditado.'); await load();
    } finally { setSaving(false); }
  }

  useEffect(() => { void load(); }, []);

  return (
    <section>
      <div className="section-heading"><div><span className="eyebrow">SEC-013 / SEC-020</span><h2>Áreas e Dispositivos</h2></div><div className="structure-counts"><span>{areas.length} áreas</span><span>{devices.length} dispositivos</span></div></div>
      {message && <div className="structure-message">{message}</div>}
      <div className="structure-grid">
        <form className="structure-card" onSubmit={createArea}>
          <strong>Área privada</strong><p>Crie zonas como residência, galpão, máquinas ou área crítica. O polígono será desenhado no módulo de mapa.</p>
          <label>Propriedade<select required value={areaProperty} onChange={(e) => setAreaProperty(e.target.value)}><option value="">Selecione</option>{properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Nome<input required value={areaName} onChange={(e) => setAreaName(e.target.value)} /></label>
          <label>Tipo<select value={areaType} onChange={(e) => setAreaType(e.target.value)}><option value="critical">Crítica</option><option value="residence">Residência</option><option value="warehouse">Galpão</option><option value="machinery">Máquinas</option><option value="other">Outra</option></select></label>
          <button className="primary" disabled={saving || !areaProperty}>Criar área</button>
        </form>

        <form className="structure-card" onSubmit={createDevice}>
          <strong>Registrar dispositivo</strong><p>Community e Private são escopos independentes. Dispositivo novo inicia offline até a primeira telemetria.</p>
          <label>Escopo<select value={scope} onChange={(e) => { setScope(e.target.value as 'community'|'private'); setAreaId(''); }}><option value="private">Privado</option><option value="community">Comunitário</option></select></label>
          {scope === 'community' ? <label>Bairro<select required value={neighborhoodId} onChange={(e) => setNeighborhoodId(e.target.value)}><option value="">Selecione</option>{neighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <><label>Propriedade<select required value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setAreaId(''); }}><option value="">Selecione</option>{properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Área<select value={areaId} onChange={(e) => setAreaId(e.target.value)}><option value="">Sem área específica</option>{propertyAreas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
          <div className="field-row"><label>Tipo<select value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>{deviceTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Nome<input required value={deviceName} onChange={(e) => setDeviceName(e.target.value)} /></label></div>
          <div className="field-row"><label>Fabricante<input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></label><label>Modelo<input value={model} onChange={(e) => setModel(e.target.value)} /></label></div>
          <label>Serial<input value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
          <div className="field-row"><label>Latitude<input type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label><label>Longitude<input type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label></div>
          <button className="primary" disabled={saving || (scope === 'community' ? !neighborhoodId : !propertyId)}>Registrar dispositivo</button>
        </form>
      </div>
    </section>
  );
}
