let pedidos = JSON.parse(localStorage.getItem("pedidos")) || [];
let mapa = null;
let marcadores = [];
let rutaLayer = null;
let mapaAjustado = false;
let nextPedidoId = 1;

function initMap() {
  mapa = L.map('mapa').setView([4.6097, -74.0817], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(mapa);
  actualizarMarcadores();
}

function procesarPedido() {
  const texto = document.getElementById("textoPedido").value.trim();
  if (!texto) {
    alert("Por favor, pega el formato del pedido");
    return;
  }

  const numeroMatch = texto.match(/^(\d+):/);
  const numeroPedido = numeroMatch ? parseInt(numeroMatch[1]) : null;

  const direccionMatch = texto.match(/📍\s*Dirección completa[^\n]*:\s*([^\n]+(?:\n[^\n]+)*?)(?=\n|$)/);
  const direccion = direccionMatch ? direccionMatch[1].trim().replace(/\n/g, ' ') : '';

  const nombreMatch = texto.match(/🙋🏻\s*Nombre[^\n]*:\s*([^\n]+)/);
  const nombre = nombreMatch ? nombreMatch[1].trim() : '';

  const telefonoMatch = texto.match(/📲\s*Número de celular[^\n]*:\s*([^\n]+)/);
  const telefono = telefonoMatch ? telefonoMatch[1].trim().replace(/\D/g, '') : '';

  const valorMatch = texto.match(/💰\s*Valor a pagar[^\n]*:\s*([^\n]+)/);
  let valor = valorMatch ? valorMatch[1].trim() : '0';
  valor = valor.replace(/[^\d]/g, '');
  if (!valor || valor === '') valor = '0';

  const productoMatch = texto.match(/Producto\s*🎁[^\n]*:\s*([^\n]+(?:\n[^\n]+)*?)(?=\n|$)/);
  const productos = productoMatch ? productoMatch[1].trim().split('\n').filter(p => p.trim()) : [];

  const mapUrl = document.getElementById("mapUrlPedido").value.trim();
  if (!mapUrl) {
    alert("Debes ingresar la URL de Google Maps del pedido para poder cargarlo.");
    return;
  }

  let pedidoId;
  if (numeroPedido) {
    if (pedidos.some(p => p.id === numeroPedido)) {
      pedidoId = Math.max(...pedidos.map(p => p.id), 0) + 1;
    } else {
      pedidoId = numeroPedido;
    }
  } else {
    pedidoId = Math.max(...pedidos.map(p => p.id), 0) + 1;
  }

  const nuevoPedido = {
    id: pedidoId,
    nombre,
    telefono,
    direccion,
    productos,
    valor,
    textoOriginal: texto,
    mapUrl,
    entregado: false
  };

  pedidos.push(nuevoPedido);
  guardarPedidos();
  renderPedidos();

  setTimeout(() => {
    if (!mapa) {
      alert('El mapa no está listo. Por favor, espera un momento e intenta nuevamente.');
      return;
    }
    procesarURLMapaPedido(mapUrl, pedidoId, productos, () => {
      ajustarVistaMapa();
      dibujarRutaEntreMarcadores();
    });
  }, 500);

  document.getElementById("textoPedido").value = "";
  document.getElementById("mapUrlPedido").value = "";
  alert(`Pedido #${pedidoId} agregado exitosamente`);
}

function guardarPedidos() {
  localStorage.setItem("pedidos", JSON.stringify(pedidos));
}

function renderPedidos() {
  const lista = document.getElementById("listaPedidos");

  if (pedidos.length === 0) {
    lista.innerHTML = '<div class="empty-state" id="emptyState"><p>No hay pedidos aún</p><p style="font-size: 14px;">Pega un formato de pedido arriba para comenzar</p></div>';
    return;
  }

  lista.innerHTML = "";

  const pedidosOrdenados = [...pedidos].sort((a, b) => {
    return (a.entregado ? 1 : 0) - (b.entregado ? 1 : 0);
  });

  pedidosOrdenados.forEach((pedido) => {
    const index = pedidos.indexOf(pedido);
    const div = document.createElement("div");
    div.className = "pedido" + (pedido.entregado ? " entregado" : "");
    div.draggable = !pedido.entregado;
    div.dataset.index = index;
    div.dataset.id = pedido.id;

    const telefonoLimpio = pedido.telefono ? pedido.telefono.replace(/\D/g, '') : '';
    const valorFormato = parseInt(pedido.valor || 0).toLocaleString('es-CO');
    const btnNoEntregadoHtml = pedido.entregado
      ? `<div class="pedido-no-entregado-wrap"><button class="btn-warning" onclick="marcarNoEntregado(${index})" style="width: 100%;">↩️ No entregado</button></div>`
      : '';

    div.innerHTML = `
      <div class="pedido-header">
        <div class="pedido-numero">Pedido #${pedido.id}${pedido.entregado ? ' ✓ Entregado' : ''}</div>
        <button class="btn-danger" onclick="eliminarPedido(${index})" style="padding: 5px 10px; font-size: 12px;">✕ Eliminar</button>
      </div>
      <div class="pedido-info">
        <strong>👤 Nombre:</strong> ${pedido.nombre || 'No especificado'}<br>
        <strong>📞 Teléfono:</strong> ${pedido.telefono || 'No especificado'}<br>
        <strong>📍 Dirección:</strong> ${pedido.direccion || 'No especificada'}<br>
        <strong>🎁 Productos:</strong> ${pedido.productos && pedido.productos.length > 0 ? pedido.productos.join(', ') : 'No especificado'}<br>
        <strong>💰 Valor:</strong> $${valorFormato}<br>
      </div>
      <div class="pedido-buttons">
        <button class="btn-success" onclick="whatsappLlamar('${telefonoLimpio}')">📞 WhatsApp Llamar</button>
        <button class="btn-success" onclick="whatsappMensaje('${telefonoLimpio}')">💬 WhatsApp Mensaje</button>
        <button class="btn-info" onclick="llamar('${telefonoLimpio}')">📱 Llamar Normal</button>
      </div>
      <div class="pedido-actions">
        <div class="pedido-actions-row">
          <button class="btn-camera" onclick="fotoEntregado(${index}, ${pedido.id})">✅ Foto Entregado</button>
          <button class="btn-camera" onclick="fotoNoEntregado(${index}, ${pedido.id})">❌ Foto No Entregado</button>
        </div>
        <div class="pedido-actions-row">
          <button class="btn-route" onclick="enrutarConMaps(${index}, ${pedido.id})">🗺️ Maps</button>
          <button class="btn-route" onclick="enrutarConWaze(${index}, ${pedido.id})">📍 Waze</button>
          <button class="btn-notify" onclick="notificarEnCamino(${index}, ${pedido.id})">📢 Notificar en Camino</button>
        </div>
      </div>
      ${btnNoEntregadoHtml}
    `;

    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragover', handleDragOver);
    div.addEventListener('drop', handleDrop);
    div.addEventListener('dragend', handleDragEnd);
    lista.appendChild(div);
  });

  const totalRecogido = pedidos.filter(p => p.entregado && !p.noEntregado).reduce((sum, p) => sum + parseInt(p.valor || 0, 10), 0);
  const elTotal = document.getElementById('totalRecogido');
  const elValor = document.getElementById('totalRecogidoValor');
  if (elTotal && elValor) {
    elValor.textContent = totalRecogido.toLocaleString('es-CO');
    elTotal.style.display = totalRecogido > 0 ? 'block' : 'none';
  }
}

// --- Drag and Drop ---
let draggedElement = null;

function handleDragStart(e) {
  draggedElement = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDrop(e) {
  e.stopPropagation();
  if (draggedElement !== this) {
    const draggedIndex = parseInt(draggedElement.dataset.index);
    const targetIndex = parseInt(this.dataset.index);
    const [removed] = pedidos.splice(draggedIndex, 1);
    pedidos.splice(targetIndex, 0, removed);
    guardarPedidos();
    renderPedidos();
    actualizarMarcadores();
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove('dragging');
}

// --- Gestión de pedidos ---

function eliminarPedido(index) {
  if (confirm(`¿Estás seguro de eliminar el pedido #${pedidos[index].id}?`)) {
    pedidos.splice(index, 1);
    guardarPedidos();
    renderPedidos();
    actualizarMarcadores();
  }
}

function marcarEntregado(index) {
  const pedido = pedidos[index];
  if (!pedido) return;
  pedido.entregado = true;
  pedidos.splice(index, 1);
  pedidos.push(pedido);
  guardarPedidos();
  renderPedidos();
  actualizarMarcadores();
}

function marcarNoEntregado(index) {
  const pedido = pedidos[index];
  if (!pedido) return;
  pedido.entregado = false;
  pedido.noEntregado = false;
  pedidos.splice(index, 1);
  pedidos.unshift(pedido);
  guardarPedidos();
  renderPedidos();
  actualizarMarcadores();
}

function eliminarTodos() {
  if (confirm("¿Estás seguro de eliminar TODOS los pedidos? Esta acción no se puede deshacer.")) {
    pedidos = [];
    guardarPedidos();
    renderPedidos();
    actualizarMarcadores();
  }
}

// --- Comunicación ---

function llamar(numero) {
  if (!numero) { alert("No hay número de teléfono disponible"); return; }
  const n = numero.toString().replace(/\D/g, '');
  if (!n) { alert("Número de teléfono inválido"); return; }
  window.location.href = `tel:${n}`;
}

function whatsappLlamar(numero) {
  if (!numero) { alert("No hay número de teléfono disponible"); return; }
  const n = numero.toString().replace(/\D/g, '');
  if (!n) { alert("Número de teléfono inválido"); return; }
  const wa = n.startsWith('57') ? n : `57${n}`;
  window.open(`https://wa.me/${wa}`, "_blank");
}

function whatsappMensaje(numero) {
  if (!numero) { alert("No hay número de teléfono disponible"); return; }
  const n = numero.toString().replace(/\D/g, '');
  if (!n) { alert("Número de teléfono inválido"); return; }
  const wa = n.startsWith('57') ? n : `57${n}`;
  window.open(`https://wa.me/${wa}?text=Hola`, "_blank");
}

// --- Fotos / WhatsApp Admin ---

function fotoEntregado(index, pedidoId) {
  const numeroAdmin = '573143473582';
  const mensaje = `Pedido #${pedidoId} entregado`;
  window.open(`https://wa.me/${numeroAdmin}?text=${encodeURIComponent(mensaje)}`, '_blank');
  const pedido = pedidos[index];
  if (!pedido) return;
  pedido.noEntregado = false;
  marcarEntregado(index);
}

function fotoNoEntregado(index, pedidoId) {
  const numeroAdmin = '573143473582';
  const mensaje = `Pedido #${pedidoId} no entregado`;
  window.open(`https://wa.me/${numeroAdmin}?text=${encodeURIComponent(mensaje)}`, '_blank');
  const pedido = pedidos[index];
  if (!pedido) return;
  pedido.entregado = true;
  pedido.noEntregado = true;
  pedidos.splice(index, 1);
  pedidos.push(pedido);
  guardarPedidos();
  renderPedidos();
  actualizarMarcadores();
}

// --- Enrutamiento ---

function getUbicacionPedido(index, pedidoId) {
  const pedido = pedidos[index];
  if (!pedido) return null;
  let lat = null, lng = null;
  const marcadorPedido = marcadores.find(m => m.pedidoId === pedidoId);
  if (marcadorPedido && marcadorPedido.marker) {
    const pos = marcadorPedido.marker.getLatLng();
    lat = pos.lat;
    lng = pos.lng;
  }
  if ((!lat || !lng) && pedido.mapUrl) {
    const match = pedido.mapUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (match) { lat = parseFloat(match[1]); lng = parseFloat(match[2]); }
  }
  if (lat != null && lng != null) return { lat, lng };
  if (pedido.direccion) return { direccion: pedido.direccion };
  return null;
}

function enrutarConMaps(index, pedidoId) {
  const u = getUbicacionPedido(index, pedidoId);
  if (!u) { alert('No hay ubicación disponible para este pedido.'); return; }
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  if (u.lat != null && u.lng != null) {
    if (isIOS) {
      window.location.href = `maps://maps.google.com/maps?daddr=${u.lat},${u.lng}&directionsmode=driving`;
      setTimeout(() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${u.lat},${u.lng}&travelmode=driving`, '_blank'), 1000);
    } else if (isAndroid) {
      window.location.href = `google.navigation:q=${u.lat},${u.lng}`;
      setTimeout(() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${u.lat},${u.lng}&travelmode=driving`, '_blank'), 1000);
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${u.lat},${u.lng}&travelmode=driving`, '_blank');
    }
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(u.direccion)}&travelmode=driving`, '_blank');
  }
}

function enrutarConWaze(index, pedidoId) {
  const u = getUbicacionPedido(index, pedidoId);
  if (!u) { alert('No hay ubicación disponible para este pedido.'); return; }
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (u.lat != null && u.lng != null) {
    if (isMobile) {
      window.location.href = `waze://?ll=${u.lat},${u.lng}&navigate=yes`;
      setTimeout(() => window.open(`https://waze.com/ul?ll=${u.lat},${u.lng}&navigate=yes`, '_blank'), 1000);
    } else {
      window.open(`https://waze.com/ul?ll=${u.lat},${u.lng}&navigate=yes`, '_blank');
    }
  } else {
    const q = encodeURIComponent(u.direccion);
    if (isMobile) {
      window.location.href = `waze://?q=${q}&navigate=yes`;
      setTimeout(() => window.open(`https://waze.com/ul?q=${q}&navigate=yes`, '_blank'), 1000);
    } else {
      window.open(`https://waze.com/ul?q=${q}&navigate=yes`, '_blank');
    }
  }
}

// --- Notificar en camino ---

function notificarEnCamino(index, pedidoId) {
  const pedido = pedidos[index];
  if (!pedido) return;
  const telefonoCliente = pedido.telefono ? String(pedido.telefono).replace(/\D/g, '') : '';
  if (!telefonoCliente) { alert('No hay número de teléfono del cliente disponible'); return; }

  const nombre = pedido.nombre || 'cliente';
  const precio = parseInt(pedido.valor || 0, 10).toLocaleString('es-CO');
  const wa = telefonoCliente.startsWith('57') ? telefonoCliente : `57${telefonoCliente}`;

  const mensaje = `Hola ${nombre}

Te informamos que nuestro repartidor de Valero Store se encuentra en camino hacia tu ubicación para entregar el pedido.

Por favor ten en cuenta:
- Estar pendiente con los $${precio} en mano
- El repartidor NO CUENTA CON CAMBIO
- El tiempo de espera desde la llegada al punto de entrega es de 10 minutos

Si deseas pagar por Nequi o Daviplata, el número es: 3143645061
Aparecerá como Mic**** Por*******
O si gustas puedes pagar por Bre-B con la llave: @NEQUIMIC7057

Gracias por tu compra ${nombre}`;

  window.open(`https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}`, '_blank');
}

// --- Mapa: marcadores y ruta ---

function actualizarMarcadores() {
  if (!mapa) return;
  marcadores.forEach(item => mapa.removeLayer(item.marker));
  marcadores = [];
  if (rutaLayer) { mapa.removeLayer(rutaLayer); rutaLayer = null; }
  if (pedidos.length === 0) return;

  let completados = 0;
  const conUbicacion = pedidos.filter(p => p.mapUrl || p.direccion);
  const total = conUbicacion.length;
  if (total === 0) return;

  conUbicacion.forEach((pedido, i) => {
    const id = pedido.id;
    const url = pedido.mapUrl;
    const dir = pedido.direccion;
    const prods = pedido.productos;
    setTimeout(() => {
      const cb = () => {
        completados++;
        if (completados === total) {
          ajustarVistaMapa();
          dibujarRutaEntreMarcadores();
        }
      };
      if (url) {
        procesarURLMapaPedido(url, id, prods, cb);
      } else if (dir) {
        geocodificarDireccion(dir, id, prods, cb);
      }
    }, i * 1000);
  });
}

function crearIconoMarcador(numPedido) {
  const html = `
    <div style="background-color:#f44336;color:white;width:35px;height:35px;
                border-radius:50%;display:flex;align-items:center;justify-content:center;
                font-weight:bold;font-size:14px;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3);">
      #${numPedido}
    </div>`;
  return L.divIcon({ html, className: 'custom-marker', iconSize: [35, 35], iconAnchor: [17, 17] });
}

function geocodificarDireccion(direccion, pedidoId, productos, callback) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(direccion)}&limit=1`;
  fetch(url, { headers: { 'User-Agent': 'DeliveryApp/1.0' } })
    .then(r => r.json())
    .then(data => {
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        const marker = L.marker([lat, lng], { icon: crearIconoMarcador(Number(pedidoId)) }).addTo(mapa);
        marker.bindPopup(`
          <div style="padding:5px;min-width:200px;">
            <h3 style="margin:0 0 10px 0;color:#4CAF50;font-size:16px;">Pedido #${pedidoId}</h3>
            <p style="margin:5px 0;"><strong>Dirección:</strong> ${direccion}</p>
            <p style="margin:5px 0;"><strong>Productos:</strong> ${productos && productos.length > 0 ? productos.join(', ') : 'No especificado'}</p>
          </div>`);
        if (pedidoId !== 'TEMP') marcadores.push({ pedidoId, marker });
      }
      if (callback) callback();
    })
    .catch(() => { if (callback) callback(); });
}

function ajustarVistaMapa() {
  if (mapaAjustado || marcadores.length === 0) return;
  const group = new L.featureGroup(marcadores.map(item => item.marker));
  mapa.fitBounds(group.getBounds().pad(0.1));
  if (marcadores.length === 1) mapa.setZoom(15);
  mapaAjustado = true;
}

function dibujarRutaEntreMarcadores() {
  if (!mapa || marcadores.length < 2) return;
  if (rutaLayer) { mapa.removeLayer(rutaLayer); rutaLayer = null; }

  const coordenadas = [];
  for (const p of pedidos) {
    const item = marcadores.find(m => m.pedidoId === p.id);
    if (item && item.marker) {
      const ll = item.marker.getLatLng();
      coordenadas.push([ll.lng, ll.lat]);
    }
  }
  if (coordenadas.length < 2) return;

  const coordsStr = coordenadas.map(c => c.join(',')).join(';');
  fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`)
    .then(r => r.json())
    .then(data => {
      if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) return;
      const latlngs = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      rutaLayer = L.polyline(latlngs, { color: '#2196F3', weight: 5, opacity: 0.7 }).addTo(mapa);
    })
    .catch(() => {
      const latlngs = coordenadas.map(c => [c[1], c[0]]);
      rutaLayer = L.polyline(latlngs, { color: '#2196F3', weight: 4, opacity: 0.6, dashArray: '10, 10' }).addTo(mapa);
    });
}

function extraerCoordenadas(url) {
  const patrones = [
    /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /place\/[^@]+@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /query=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/
  ];
  for (const p of patrones) {
    const m = url.match(p);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}

function procesarURLMapaPedido(url, pedidoId, productos, callback) {
  if (!mapa) { if (callback) callback(); return; }

  const coords = extraerCoordenadas(url);
  if (!coords) {
    geocodificarDireccion(url, pedidoId, productos || [], callback);
    return;
  }

  const { lat, lng } = coords;
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    alert(`No se pudieron extraer coordenadas válidas de la URL para el pedido #${pedidoId}.`);
    if (callback) callback();
    return;
  }

  try {
    const marker = L.marker([lat, lng], { icon: crearIconoMarcador(Number(pedidoId)) }).addTo(mapa);
    marker.bindPopup(`
      <div style="padding:5px;min-width:200px;">
        <h3 style="margin:0 0 10px 0;color:#4CAF50;font-size:16px;">Pedido #${pedidoId}</h3>
        <p style="margin:5px 0;"><strong>Productos:</strong> ${productos && productos.length > 0 ? productos.join(', ') : 'No especificado'}</p>
      </div>`);
    marcadores.push({ pedidoId, marker });
    if (callback) callback();
  } catch (error) {
    alert(`Error al agregar marcador para el pedido #${pedidoId}: ${error.message}`);
    if (callback) callback();
  }
}

// --- Sincronización ---

function exportarDatos() {
  if (pedidos.length === 0) { alert('No hay pedidos para exportar'); return; }
  const datosJSON = JSON.stringify({ pedidos, timestamp: new Date().toISOString(), version: '1.0' });
  const codificado = btoa(unescape(encodeURIComponent(datosJSON)));
  const urlCompartir = window.location.origin + window.location.pathname + '?data=' + encodeURIComponent(codificado);

  const syncArea = document.getElementById('syncCodeArea');
  const syncData = document.getElementById('syncData');
  syncArea.style.display = 'block';
  syncData.value = codificado;
  syncData.select();

  mostrarQR(codificado);

  const infoDiv = document.querySelector('.sync-info');
  if (infoDiv) {
    infoDiv.innerHTML = `
      <strong>Opciones de sincronización:</strong><br>
      1. Escanea el código QR con tu celular<br>
      2. Copia el código de texto y pégalo en tu celular<br>
      3. Comparte este enlace: <a href="${urlCompartir}" target="_blank" style="word-break:break-all;color:#2196F3;">${urlCompartir.substring(0, 50)}...</a><br><br>
      <strong>Total de pedidos:</strong> ${pedidos.length}`;
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(urlCompartir).catch(() => {});
  }
}

function importarDatos() {
  document.getElementById('syncCodeArea').style.display = 'block';
  document.getElementById('syncData').focus();
}

function aplicarImportacion() {
  const codificado = document.getElementById('syncData').value.trim();
  if (!codificado) { alert('Por favor, pega el código de sincronización'); return; }

  try {
    const datos = JSON.parse(decodeURIComponent(escape(atob(codificado))));
    if (!datos.pedidos || !Array.isArray(datos.pedidos)) throw new Error('Formato de datos inválido');
    if (!confirm(`¿Importar ${datos.pedidos.length} pedido(s)?\n\nEsto reemplazará todos los pedidos actuales.`)) return;

    pedidos = datos.pedidos.map(p => {
      if (!p.hasOwnProperty('mapUrl')) p.mapUrl = '';
      if (!p.hasOwnProperty('entregado')) p.entregado = false;
      return p;
    });

    guardarPedidos();
    renderPedidos();
    setTimeout(() => actualizarMarcadores(), 500);

    document.getElementById('syncCodeArea').style.display = 'none';
    document.getElementById('qrContainer').style.display = 'none';
    document.getElementById('syncData').value = '';
    alert(`✅ ${pedidos.length} pedido(s) importado(s) exitosamente!`);
  } catch (error) {
    alert('❌ Error al importar datos. Verifica que el código sea correcto.\n\nError: ' + error.message);
  }
}

function mostrarQR(codificado) {
  const qrContainer = document.getElementById('qrContainer');
  const canvas = document.getElementById('qrCode');

  if (!codificado) {
    if (pedidos.length === 0) { alert('No hay pedidos para generar QR'); return; }
    const datosJSON = JSON.stringify({ pedidos, timestamp: new Date().toISOString(), version: '1.0' });
    codificado = btoa(unescape(encodeURIComponent(datosJSON)));
  }

  qrContainer.style.display = 'block';
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const qrSize = isMobile ? 250 : 300;
  canvas.width = qrSize;
  canvas.height = qrSize;

  QRCode.toCanvas(canvas, codificado, {
    width: qrSize, margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' }
  }, function (error) {
    if (error) {
      qrContainer.innerHTML = '<p style="color:red;padding:20px;">Error al generar código QR. Usa el código de texto en su lugar.</p>';
    }
  });
}

function verificarDatosEnURL() {
  const datosURL = new URLSearchParams(window.location.search).get('data');
  if (datosURL) {
    if (confirm('¿Importar datos desde el enlace compartido?')) {
      document.getElementById('syncData').value = datosURL;
      aplicarImportacion();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

// --- Inicialización ---

window.onload = function () {
  pedidos = pedidos.map(p => {
    if (!p.hasOwnProperty('mapUrl')) p.mapUrl = '';
    if (!p.hasOwnProperty('entregado')) p.entregado = false;
    return p;
  });
  guardarPedidos();

  if (pedidos.length > 0) {
    nextPedidoId = Math.max(...pedidos.map(p => p.id)) + 1;
  }

  renderPedidos();
  initMap();
  verificarDatosEnURL();
};
