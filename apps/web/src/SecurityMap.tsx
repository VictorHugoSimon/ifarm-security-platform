import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { neon } from './lib/neon';

type MapFeature = {
  feature_type: 'property' | 'area' | 'device' | 'incident';
  feature_id: string;
  name: string;
  scope: 'community' | 'private';
  subtype: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  organization_id: string;
  neighborhood_id?: string | null;
  property_id?: string | null;
  area_id?: string | null;
  geometry_geojson?: GeoJSON.GeoJsonObject | null;
};

type Property = { id: string; name: string };

const DEFAULT_CENTER: L.LatLngExpression = [-14.235, -51.9253];

function featureColor(feature: MapFeature) {
  if (feature.feature_type === 'incident') return '#b42318';
  if (feature.scope === 'community') return '#155eef';
  if (feature.status === 'online') return '#177245';
  if (feature.status === 'degraded') return '#b54708';
  if (feature.status === 'maintenance') return '#7f56d9';
  if (feature.feature_type === 'area') return '#6941c6';
  if (feature.feature_type === 'property') return '#0e7090';
  return '#667085';
}

function tooltipNode(feature: MapFeature) {
  const node = document.createElement('div');
  const title = document.createElement('strong');
  const detail = document.createElement('div');
  title.textContent = feature.name;
  detail.textContent = `${feature.feature_type} · ${feature.scope} · ${feature.status}`;
  node.append(title, detail);
  return node;
}

export function SecurityMap() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const featureLayer = useRef<L.LayerGroup | null>(null);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'community' | 'private'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | MapFeature['feature_type']>('all');
  const [selectedProperty, setSelectedProperty] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const visibleFeatures = useMemo(() => features.filter((feature) => {
    if (scopeFilter !== 'all' && feature.scope !== scopeFilter) return false;
    if (typeFilter !== 'all' && feature.feature_type !== typeFilter) return false;
    return true;
  }), [features, scopeFilter, typeFilter]);

  async function load() {
    const [mapResult, propertyResult] = await Promise.all([
      neon.rpc('get_security_map'),
      neon.from('properties').select('id,name')
    ]);
    if (mapResult.error || propertyResult.error) {
      setMessage('Não foi possível carregar o mapa autorizado.');
      return;
    }
    const rows = (mapResult.data || []) as MapFeature[];
    const propertyRows = (propertyResult.data || []) as Property[];
    setFeatures(rows);
    setProperties(propertyRows);
    setSelectedProperty((current) => current || propertyRows[0]?.id || '');
    setMessage(rows.length ? '' : 'Nenhum ponto georreferenciado disponível para esta sessão.');
  }

  async function updatePropertyLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setMessage('Informe latitude e longitude válidas.');
        return;
      }
      const result = await neon.rpc('set_property_location', {
        p_property_id: selectedProperty,
        p_latitude: lat,
        p_longitude: lng
      });
      if (result.error) {
        setMessage(result.error.message.includes('property_management_required')
          ? 'Seu perfil não pode alterar a localização desta propriedade.'
          : 'Não foi possível atualizar a localização.');
        return;
      }
      setMessage('Localização da propriedade atualizada e auditada.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!mapNode.current || map.current) return;
    const instance = L.map(mapNode.current, { zoomControl: true }).setView(DEFAULT_CENTER, 4);
    if (import.meta.env.DEV) {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(instance);
    }
    const layer = L.layerGroup().addTo(instance);
    map.current = instance;
    featureLayer.current = layer;
    return () => {
      instance.remove();
      map.current = null;
      featureLayer.current = null;
    };
  }, []);

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const instance = map.current;
    const layer = featureLayer.current;
    if (!instance || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);

    visibleFeatures.forEach((feature) => {
      const color = featureColor(feature);
      if (feature.geometry_geojson) {
        const geometry = L.geoJSON(feature.geometry_geojson, {
          style: { color, weight: 2, fillColor: color, fillOpacity: 0.08 }
        }).addTo(layer);
        geometry.bindTooltip(tooltipNode(feature));
        const geometryBounds = geometry.getBounds();
        if (geometryBounds.isValid()) bounds.extend(geometryBounds);
      }
      if (feature.latitude !== null && feature.longitude !== null) {
        const point = L.circleMarker([feature.latitude, feature.longitude], {
          radius: feature.feature_type === 'incident' ? 9 : 7,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.85
        }).addTo(layer);
        point.bindTooltip(tooltipNode(feature));
        bounds.extend([feature.latitude, feature.longitude]);
      }
    });

    if (bounds.isValid()) instance.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    else instance.setView(DEFAULT_CENTER, 4);
  }, [visibleFeatures]);

  const communityCount = features.filter((feature) => feature.scope === 'community').length;
  const privateCount = features.filter((feature) => feature.scope === 'private').length;
  const offlineCount = features.filter((feature) => feature.feature_type === 'device' && feature.status === 'offline').length;

  return (
    <section id="security-map">
      <div className="section-heading">
        <div><span className="eyebrow">SEC-030</span><h2>Security Map</h2></div>
        <div className="structure-counts"><span>{features.length} pontos</span><span>{communityCount} community</span><span>{privateCount} private</span><span>{offlineCount} offline</span></div>
      </div>
      <div className="map-toolbar">
        <label>Escopo<select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)}><option value="all">Todos</option><option value="community">Community</option><option value="private">Private</option></select></label>
        <label>Camada<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">Todas</option><option value="property">Propriedades</option><option value="area">Áreas</option><option value="device">Dispositivos</option><option value="incident">Incidentes</option></select></label>
        <button className="secondary" type="button" onClick={() => void load()}>Atualizar mapa</button>
      </div>
      <div className="security-map-layout">
        <div className="map-panel">
          <div ref={mapNode} className="map-canvas" aria-label="Mapa georreferenciado do iFarm Security" />
          {!import.meta.env.DEV && <div className="map-privacy-banner">Base cartográfica externa desativada fora do DEV. PROD exigirá provedor privado/contratado.</div>}
        </div>
        <form className="structure-card map-location-form" onSubmit={updatePropertyLocation}>
          <strong>Posicionar propriedade</strong>
          <p>Atualiza somente a propriedade autorizada. Toda alteração gera registro de auditoria.</p>
          <label>Propriedade<select required value={selectedProperty} onChange={(event) => setSelectedProperty(event.target.value)}><option value="">Selecione</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
          <div className="field-row map-coordinate-row"><label>Latitude<input type="number" step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>Longitude<input type="number" step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div>
          <button className="primary" disabled={saving || !selectedProperty}>{saving ? 'Salvando…' : 'Salvar localização'}</button>
          <small className="map-note">Desenho de perímetro e áreas usa GeoJSON/PostGIS e será habilitado na próxima evolução do editor cartográfico.</small>
        </form>
      </div>
      {message && <div className="structure-message">{message}</div>}
      <div className="map-privacy-note"><strong>Privacidade cartográfica:</strong> tiles públicos são usados apenas em DEV. Marcadores, propriedades, incidentes e coordenadas permanecem entregues pelo Neon sob RLS e não são enviados ao provedor de tiles.</div>
    </section>
  );
}
