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

function limpiarTimestampsChat(texto) {
  return texto
    .replace(/\u200E|\u200F|\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/\[\d{1,2}:\d{2}[^\]]{0,30}\]\s*[^:\n]+:\s*/g, '');
}

function generarPedidoId(numeroPedido) {
  if (numeroPedido && !pedidos.some(p => p.id === numeroPedido)) {
    return numeroPedido;
  }
  return Math.max(...pedidos.map(p => p.id), 0) + 1;
}

function extraerCamposPedido(bloque) {
  const dirMatch = bloque.match(/📍[^\n]*:\s*([\s\S]*?)(?=🙋|$)/);
  const direccion = dirMatch ? dirMatch[1].trim().replace(/\n\s*/g, ' ').trim() : '';

  const nomMatch = bloque.match(/🙋[^\n]*Nombre[^\n]*:\s*([\s\S]*?)(?=📲|$)/);
  const nombre = nomMatch ? nomMatch[1].trim().split('\n')[0].trim() : '';

  const telMatch = bloque.match(/📲[^\n]*:\s*([\s\S]*?)(?=💰|$)/);
  const telRaw = telMatch ? telMatch[1].trim().split('\n')[0].trim() : '';
  const primerTel = telRaw.match(/[\d\s]+/);
  const telefono = primerTel ? primerTel[0].replace(/\s/g, '') : '';

  const valMatch = bloque.match(/💰[^\n]*:\s*([\s\S]*?)(?=Envío|$)/);
  let valor = valMatch ? valMatch[1].trim().split('\n')[0].trim() : '0';
  valor = valor.replace(/[^\d]/g, '');
  if (!valor) valor = '0';

  const prodMatch = bloque.match(/Producto\s*🎁[^\n]*:\s*([\s\S]*?)(?=¿Todo en orden|$)/);
  const productos = prodMatch
    ? prodMatch[1].trim().split('\n').map(l => l.trim()).filter(l => l)
    : [];

  return { direccion, nombre, telefono, valor, productos };
}

function fetchConTimeout(url, opciones, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opciones, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function resolverUrlCorta(url) {
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  ];
  for (const proxyUrl of proxies) {
    try {
      const resp = await fetchConTimeout(proxyUrl, {}, 12000);
      const html = await resp.text();
      const coords = extraerCoordenadas(html);
      if (coords) return coords;
      const urlsEnHtml = html.match(/https?:\/\/(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.apple\.com)[^\s"'<>]+/g) || [];
      for (const u of urlsEnHtml) {
        let decoded;
        try { decoded = decodeURIComponent(u); } catch (e) { decoded = u; }
        const c = extraerCoordenadas(decoded);
        if (c) return c;
      }
      const llMatch = html.match(/"latitude"\s*:\s*(-?\d+\.\d+).*?"longitude"\s*:\s*(-?\d+\.\d+)/s);
      if (llMatch) {
        const lat = parseFloat(llMatch[1]), lng = parseFloat(llMatch[2]);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
      }
      const centerMatch = html.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (centerMatch) {
        const lat = parseFloat(centerMatch[1]), lng = parseFloat(centerMatch[2]);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
      }
    } catch (e) { continue; }
  }
  return null;
}

async function geocodificarParaCoordenadas(direccion) {
  const limpia = direccion.replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
  const consultas = [
    limpia + ', Bogotá, Colombia',
    limpia + ', Bogotá',
    limpia,
  ];
  for (const q of consultas) {
    try {
      const resp = await fetchConTimeout(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=co`,
        { headers: { 'User-Agent': 'DeliveryApp/1.0' } },
        10000
      );
      const data = await resp.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch (e) { continue; }
  }
  return null;
}

function estaEnZonaOperacion(coords) {
  if (!coords) return false;
  // Bogota y alrededores operativos
  return coords.lat >= 4.1 && coords.lat <= 5.2 && coords.lng >= -74.7 && coords.lng <= -73.5;
}

async function obtenerCoordenadas(url, direccion) {
  const coords = extraerCoordenadas(url);
  if (coords && estaEnZonaOperacion(coords)) return coords;
  if (/goo\.gl|maps\.app|maps\.apple/i.test(url)) {
    const resuelto = await resolverUrlCorta(url);
    if (resuelto && estaEnZonaOperacion(resuelto)) return resuelto;
  }
  if (direccion) {
    const geocod = await geocodificarParaCoordenadas(direccion);
    if (geocod && estaEnZonaOperacion(geocod)) return geocod;
  }
  return null;
}

async function procesarPedido() {
  const texto = document.getElementById("textoPedido").value.trim();
  if (!texto) {
    alert("Por favor, pega el formato del pedido");
    return;
  }

  if ((texto.match(/Para agilizar tu pedido/g) || []).length > 1) {
    await procesarMultiplesPedidos(texto);
    return;
  }

  const textoLimpio = limpiarTimestampsChat(texto);

  const numeroMatch = textoLimpio.match(/(\d+):\s*\n?\s*Para agilizar/) || textoLimpio.match(/^(\d+):/m);
  const numeroPedido = numeroMatch ? parseInt(numeroMatch[1]) : null;

  const campos = extraerCamposPedido(textoLimpio);

  const urlEnTexto = texto.match(/https?:\/\/(?:(?:www\.)?google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|maps\.apple\.com|maps\.apple)[^\s\n]*/i);
  const mapUrl = urlEnTexto ? urlEnTexto[0] : '';

  if (!mapUrl) {
    alert("No se encontró URL de Google Maps en el texto pegado.\n\nAsegúrate de incluir el enlace de Maps junto con el formato del pedido.");
    return;
  }

  const btnProcesar = document.querySelector('.btn-primary');
  const textoOriginalBtn = btnProcesar ? btnProcesar.textContent : '';
  if (btnProcesar) { btnProcesar.textContent = '⏳ Procesando...'; btnProcesar.disabled = true; }

  const coords = await obtenerCoordenadas(mapUrl, campos.direccion);

  if (btnProcesar) { btnProcesar.textContent = textoOriginalBtn; btnProcesar.disabled = false; }

  if (!coords) {
    alert("No se pudieron extraer coordenadas de la URL ni de la dirección.\n\nVerifica que el enlace de Maps o la dirección sean válidos.");
    return;
  }

  const pedidoId = generarPedidoId(numeroPedido);
  const mapUrlFinal = coords.lat && coords.lng
    ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}`
    : mapUrl;

  pedidos.push({
    id: pedidoId,
    nombre: campos.nombre,
    telefono: campos.telefono,
    direccion: campos.direccion,
    productos: campos.productos,
    valor: campos.valor,
    textoOriginal: texto,
    mapUrl: mapUrlFinal,
    entregado: false,
    noEntregado: false,
    envioRecogido: false
  });

  guardarPedidos();
  renderPedidos();

  setTimeout(() => {
    if (!mapa) return;
    procesarURLMapaPedido(mapUrlFinal, pedidoId, campos.productos, () => {
      ajustarVistaMapa();
      dibujarRutaEntreMarcadores();
    });
  }, 500);

  document.getElementById("textoPedido").value = "";
  alert(`Pedido #${pedidoId} agregado exitosamente`);
}

async function procesarMultiplesPedidos(texto) {
  const textoLimpio = limpiarTimestampsChat(texto);
  const bloques = textoLimpio.split(/¿Todo en orden\?\s*😊?\s*/);
  const urlRegex = /https?:\/\/(?:(?:www\.)?google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|maps\.apple\.com|maps\.apple)[^\s\n]*/i;

  let agregados = 0;
  let errores = [];

  const btnProcesar = document.querySelector('.btn-primary');
  const textoOriginalBtn = btnProcesar ? btnProcesar.textContent : '';

  for (const bloque of bloques) {
    if (!bloque.includes('📍')) continue;

    const urlMatch = bloque.match(urlRegex);
    const mapUrl = urlMatch ? urlMatch[0].trim() : '';
    const numMatch = bloque.match(/(\d+):\s*\n/);
    const numLabel = numMatch ? '#' + numMatch[1] : '?';

    if (!mapUrl) {
      errores.push(`Pedido ${numLabel}: No se encontró URL de Maps`);
      continue;
    }

    const numeroPedido = numMatch ? parseInt(numMatch[1]) : null;
    const campos = extraerCamposPedido(bloque);

    if (btnProcesar) { btnProcesar.textContent = `⏳ Procesando pedido ${numLabel}...`; btnProcesar.disabled = true; }

    const coords = await obtenerCoordenadas(mapUrl, campos.direccion);
    if (!coords) {
      errores.push(`Pedido ${numLabel}: No se pudieron extraer coordenadas`);
      continue;
    }

    const pedidoId = generarPedidoId(numeroPedido);
    const mapUrlFinal = coords.lat && coords.lng
      ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}`
      : mapUrl;

    pedidos.push({
      id: pedidoId,
      nombre: campos.nombre,
      telefono: campos.telefono,
      direccion: campos.direccion,
      productos: campos.productos,
      valor: campos.valor,
      textoOriginal: bloque.trim(),
      mapUrl: mapUrlFinal,
      entregado: false,
      noEntregado: false,
      envioRecogido: false
    });

    agregados++;
  }

  if (btnProcesar) { btnProcesar.textContent = textoOriginalBtn; btnProcesar.disabled = false; }

  if (agregados > 0) {
    guardarPedidos();
    renderPedidos();
    setTimeout(() => actualizarMarcadores(), 500);
    document.getElementById("textoPedido").value = "";
  }

  let msg = `✅ Se agregaron ${agregados} pedido(s)`;
  if (errores.length > 0) {
    msg += `\n\n⚠️ ${errores.length} pedido(s) no agregado(s):\n${errores.join('\n')}`;
  }
  alert(msg);
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

    const estadoTexto = pedido.entregado
      ? (pedido.noEntregado ? ' ✕ No entregado' : ' ✓ Entregado')
      : '';

    div.innerHTML = `
      <div class="pedido-header">
        <div class="pedido-numero">Pedido #${pedido.id}${estadoTexto}</div>
        <div class="pedido-header-btns">
          <button class="btn-edit" onclick="editarPedido(${index})" style="padding: 5px 10px; font-size: 12px;">✏️ Editar</button>
          <button class="btn-danger" onclick="eliminarPedido(${index})" style="padding: 5px 10px; font-size: 12px;">✕ Eliminar</button>
        </div>
      </div>
      <div class="pedido-info">
        <strong>👤 Nombre:</strong> ${pedido.nombre || 'No especificado'}<br>
        <strong>📞 Teléfono:</strong> ${pedido.telefono || 'No especificado'}<br>
        <strong>📍 Dirección:</strong> ${pedido.direccion || 'No especificada'}<br>
        <strong>🎁 Productos:</strong> ${pedido.productos && pedido.productos.length > 0 ? pedido.productos.join(', ') : 'No especificado'}<br>
        <strong>💰 Valor:</strong> $${valorFormato}<br>
        <strong>🔗 URL Maps:</strong> <span style="font-size:12px;word-break:break-all;">${pedido.mapUrl ? pedido.mapUrl.substring(0, 50) + '...' : 'No especificada'}</span><br>
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

  const recogidoDelDia = pedidos.filter(p => p.entregado && !p.noEntregado).reduce((sum, p) => sum + parseInt(p.valor || 0, 10), 0);
  const enviosEntregados = pedidos.filter(p => p.entregado && !p.noEntregado).length;
  const enviosNoEntregadosEnPunto = pedidos.filter(p => p.noEntregado && p.envioRecogido).length;
  const pagoDomiciliario = (enviosEntregados + enviosNoEntregadosEnPunto) * 12000;
  const entregarTienda = recogidoDelDia - pagoDomiciliario;

  const elResumen = document.getElementById('totalesResumen');
  if (elResumen) {
    document.getElementById('totalRecogidoDia').textContent = recogidoDelDia.toLocaleString('es-CO');
    document.getElementById('totalPagoDomiciliario').textContent = pagoDomiciliario.toLocaleString('es-CO');
    document.getElementById('totalEntregarTienda').textContent = entregarTienda.toLocaleString('es-CO');
    elResumen.style.display = (recogidoDelDia > 0 || pagoDomiciliario > 0) ? 'flex' : 'none';
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
  pedido.envioRecogido = false;
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

// --- Editar pedido ---

function editarPedido(index) {
  const pedido = pedidos[index];
  if (!pedido) return;

  const valorActual = parseInt(pedido.valor || 0).toLocaleString('es-CO');
  const nuevoValor = prompt(`Valor actual: $${valorActual}\n\nIngresa el nuevo valor (solo números):`, pedido.valor || '0');

  if (nuevoValor !== null) {
    const valorLimpio = nuevoValor.replace(/[^\d]/g, '');
    if (valorLimpio !== '') {
      pedido.valor = valorLimpio;
    }
  }

  const nuevaUrl = prompt(`URL Maps actual:\n${pedido.mapUrl || '(vacía)'}\n\nIngresa la nueva URL de Google Maps (dejar vacío para no cambiar):`, pedido.mapUrl || '');

  if (nuevaUrl !== null && nuevaUrl.trim() !== pedido.mapUrl) {
    pedido.mapUrl = nuevaUrl.trim();
  }

  guardarPedidos();
  renderPedidos();
  actualizarMarcadores();
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
  pedido.envioRecogido = false;
  marcarEntregado(index);
}

function fotoNoEntregado(index, pedidoId) {
  const pedido = pedidos[index];
  if (!pedido) return;

  const enUbicacion = confirm('¿Te encuentras en la ubicación del pedido?\n\n✅ Aceptar = Sí, estoy en el punto (se cobra envío $12.000)\n❌ Cancelar = No fui al punto (no se cobra envío)');

  const numeroAdmin = '573143473582';
  const mensaje = `Pedido #${pedidoId} no entregado`;
  window.open(`https://wa.me/${numeroAdmin}?text=${encodeURIComponent(mensaje)}`, '_blank');

  pedido.entregado = true;
  pedido.noEntregado = true;
  pedido.envioRecogido = enUbicacion;
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
  const limpia = url.replace(/\s+/g, '').replace(/%2C/gi, ',').replace(/%40/gi, '@');
  let decoded;
  try { decoded = decodeURIComponent(limpia); } catch (e) { decoded = limpia; }

  const patrones = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /query=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /place\/[^@]*@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]sll=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /center=(-?\d+\.\d+),(-?\d+\.\d+)/,
  ];

  for (const texto of [decoded, limpia, url]) {
    for (const p of patrones) {
      const m = texto.match(p);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          return { lat, lng };
        }
      }
    }
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

function compactarPedidos() {
  return pedidos.map(p => [
    p.id,
    p.nombre || '',
    p.telefono || '',
    p.direccion || '',
    p.valor || '0',
    p.mapUrl || '',
    (p.entregado ? 1 : 0) | (p.noEntregado ? 2 : 0) | (p.envioRecogido ? 4 : 0),
    (p.productos || []).join('|')
  ]);
}

function descompactarPedidos(arr) {
  return arr.map(c => ({
    id: c[0], nombre: c[1], telefono: c[2], direccion: c[3],
    valor: c[4], mapUrl: c[5],
    entregado: !!(c[6] & 1), noEntregado: !!(c[6] & 2), envioRecogido: !!(c[6] & 4),
    productos: c[7] ? c[7].split('|') : [], textoOriginal: ''
  }));
}

function uint8ToBase64(arr) {
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

async function comprimirParaQR() {
  const json = JSON.stringify(compactarPedidos());
  if (typeof CompressionStream !== 'undefined') {
    try {
      const blob = new Blob([json]);
      const stream = blob.stream().pipeThrough(new CompressionStream('deflate'));
      const buf = await new Response(stream).arrayBuffer();
      return 'CZ:' + uint8ToBase64(new Uint8Array(buf));
    } catch (e) {}
  }
  return 'CC:' + btoa(unescape(encodeURIComponent(json)));
}

async function descomprimirDatos(str) {
  if (str.startsWith('CZ:')) {
    const bytes = Uint8Array.from(atob(str.slice(3)), c => c.charCodeAt(0));
    const blob = new Blob([bytes]);
    const stream = blob.stream().pipeThrough(new DecompressionStream('deflate'));
    return await new Response(stream).text();
  }
  if (str.startsWith('CC:')) {
    return decodeURIComponent(escape(atob(str.slice(3))));
  }
  return null;
}

async function exportarDatos() {
  if (pedidos.length === 0) { alert('No hay pedidos para exportar'); return; }

  const comprimido = await comprimirParaQR();
  const syncArea = document.getElementById('syncCodeArea');
  const syncData = document.getElementById('syncData');
  syncArea.style.display = 'block';
  syncData.value = comprimido;
  syncData.select();

  await mostrarQR();

  const infoDiv = document.querySelector('.sync-info');
  if (infoDiv) {
    infoDiv.innerHTML = `
      <strong>Opciones de sincronización:</strong><br>
      1. Escanea el código QR con tu celular<br>
      2. Copia el código de texto y pégalo en el otro dispositivo<br><br>
      <strong>Total de pedidos:</strong> ${pedidos.length}`;
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(comprimido).catch(() => {});
  }
}

function importarDatos() {
  document.getElementById('syncCodeArea').style.display = 'block';
  document.getElementById('syncData').focus();
}

async function aplicarImportacion() {
  const input = document.getElementById('syncData').value.trim();
  if (!input) { alert('Por favor, pega el código de sincronización'); return; }

  try {
    let listaPedidos;

    if (input.startsWith('CZ:') || input.startsWith('CC:')) {
      const json = await descomprimirDatos(input);
      listaPedidos = descompactarPedidos(JSON.parse(json));
    } else {
      const datos = JSON.parse(decodeURIComponent(escape(atob(input))));
      if (!datos.pedidos || !Array.isArray(datos.pedidos)) throw new Error('Formato inválido');
      listaPedidos = datos.pedidos;
    }

    if (!listaPedidos || listaPedidos.length === 0) throw new Error('No se encontraron pedidos');
    if (!confirm(`¿Importar ${listaPedidos.length} pedido(s)?\n\nEsto reemplazará todos los pedidos actuales.`)) return;

    pedidos = listaPedidos.map(p => {
      if (!p.hasOwnProperty('mapUrl')) p.mapUrl = '';
      if (!p.hasOwnProperty('entregado')) p.entregado = false;
      if (!p.hasOwnProperty('noEntregado')) p.noEntregado = false;
      if (!p.hasOwnProperty('envioRecogido')) p.envioRecogido = false;
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

async function mostrarQR() {
  const qrContainer = document.getElementById('qrContainer');
  const qrEl = document.getElementById('qrCode');

  if (pedidos.length === 0) { alert('No hay pedidos para generar QR'); return; }

  qrContainer.style.display = 'block';
  qrEl.innerHTML = '<p style="padding:20px;text-align:center;">⏳ Comprimiendo datos...</p>';

  const textoQR = await comprimirParaQR();

  if (textoQR.length > 2900) {
    qrEl.innerHTML = `
      <p style="color:#E65100;padding:15px;background:#FFF3E0;border-radius:8px;font-size:14px;">
        ⚠️ Datos muy grandes para QR aún comprimidos (${textoQR.length} chars).<br><br>
        <strong>Alternativa:</strong> Copia el código de texto de arriba y pégalo en el otro dispositivo.
      </p>`;
    return;
  }

  qrEl.innerHTML = '';
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const qrSize = isMobile ? 250 : 300;

  try {
    new QRCode(qrEl, {
      text: textoQR,
      width: qrSize,
      height: qrSize,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
  } catch (error) {
    qrEl.innerHTML = `
      <p style="color:#E65100;padding:15px;background:#FFF3E0;border-radius:8px;font-size:14px;">
        ⚠️ No se pudo generar el QR.<br><br>
        <strong>Alternativa:</strong> Copia el código de texto de arriba y pégalo en el otro dispositivo.
      </p>`;
  }
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
    if (!p.hasOwnProperty('noEntregado')) p.noEntregado = false;
    if (!p.hasOwnProperty('envioRecogido')) p.envioRecogido = false;
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
