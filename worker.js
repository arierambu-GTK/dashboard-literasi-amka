// Web Worker untuk proses data filtering yang heavy
// File: worker.js

const LITERACY_STAGES = [
  { key: 'Huruf', label: 'Huruf', type: 'max_error', threshold: 2 },
  { key: 'Suku Kata', label: 'Suku Kata', type: 'max_error', threshold: 2 },
  { key: 'Kata', label: 'Kata', type: 'max_error', threshold: 2 },
  { key: 'Paragraf', label: 'Paragraf', type: 'max_error', threshold: 2 },
  { key: 'Cerita Pendek', label: 'Cerita Pendek', type: 'max_error', threshold: 4 },
  { key: 'Pertanyaan', label: 'Pertanyaan', type: 'min_correct', threshold: 5 }
];

// Hitung level literasi tertinggi
function calculateHighestLevel(row) {
  let highestPassed = "Belum Terdeteksi";

  for (let stage of LITERACY_STAGES) {
    let rawVal = row[stage.key];
    if (rawVal === undefined || rawVal === null) break;

    let valStr = String(rawVal).trim();
    if (valStr === '' || valStr === '-') break;

    let lowerVal = valStr.toLowerCase();
    if (lowerVal === 'tidak' || lowerVal === 'tdk' || lowerVal === 'tidak lulus' || lowerVal === 'gagal' || lowerVal === 'false') {
      break;
    }

    let isPass = false;
    let numVal = parseFloat(valStr);

    if (!isNaN(numVal)) {
      if (stage.type === 'min_correct') {
        isPass = numVal >= stage.threshold;
      } else {
        isPass = numVal <= stage.threshold;
      }
    } else {
      isPass = lowerVal.includes("lulus") ||
               lowerVal.includes("ya") ||
               lowerVal.includes("lancar") ||
               lowerVal.includes("tanpa") ||
               lowerVal.includes("1-2") ||
               lowerVal === "0" ||
               lowerVal.includes("baik") ||
               lowerVal.includes("bisa") ||
               lowerVal.includes("<");
    }

    if (isPass) {
      highestPassed = stage.label;
    } else {
      break;
    }
  }

  return highestPassed === "Belum Terdeteksi" ? "Huruf" : highestPassed;
}

// Proses data mentah dengan menambahkan capaian literasi
function processRawData(allData) {
  return allData.map(item => {
    item.capaianLiterasi = calculateHighestLevel(item);
    return item;
  });
}

// Filter data dengan kriteria
function filterData(rawData, filters) {
  const { kecVal, sekVal, kelasVal, jkVal, capaianVal, searchVal } = filters;
  
  return rawData.filter(item => {
    const matchesKec = !kecVal || item["Kecamatan"] === kecVal;
    const matchesSek = !sekVal || item["Nama Sekolah"] === sekVal;
    const matchesKelas = !kelasVal || item["Kelas"] === kelasVal;
    const matchesJK = !jkVal || item["Jenis Kelamin"] === jkVal;
    const matchesCapaian = !capaianVal || item.capaianLiterasi === capaianVal;

    const namaSiswa = (item["Nama Siswa"] || "").toString().toLowerCase();
    const namaSekolah = (item["Nama Sekolah"] || "").toString().toLowerCase();
    const kecamatan = (item["Kecamatan"] || "").toString().toLowerCase();
    const matchesSearch = !searchVal || namaSiswa.includes(searchVal) || namaSekolah.includes(searchVal) || kecamatan.includes(searchVal);

    return matchesKec && matchesSek && matchesKelas && matchesJK && matchesCapaian && matchesSearch;
  });
}

// Ekstrak opsi filter dari data
function extractFilterOptions(rawData) {
  const kecSet = new Set();
  const kelasSet = new Set();
  const sekolahSet = new Set();

  rawData.forEach(item => {
    if (item["Kecamatan"] && item["Kecamatan"] !== '-') kecSet.add(item["Kecamatan"]);
    if (item["Kelas"] && item["Kelas"] !== '-') kelasSet.add(item["Kelas"]);
    if (item["Nama Sekolah"] && item["Nama Sekolah"] !== '-') sekolahSet.add(item["Nama Sekolah"]);
  });

  return {
    kecamatan: Array.from(kecSet).sort(),
    kelas: Array.from(kelasSet).sort(),
    sekolah: Array.from(sekolahSet).sort()
  };
}

// Compute statistik literasi
function computeLiteracyStats(data) {
  const totalSiswa = data.length;
  const total = totalSiswa || 1;

  const counts = { 'Huruf': 0, 'Suku Kata': 0, 'Kata': 0, 'Paragraf': 0, 'Cerita Pendek': 0, 'Pertanyaan': 0 };

  data.forEach(item => {
    if (counts[item.capaianLiterasi] !== undefined) {
      counts[item.capaianLiterasi]++;
    }
  });

  return {
    totalSiswa,
    counts,
    percentages: {
      'Huruf': Math.round((counts['Huruf'] / total) * 100),
      'Suku Kata': Math.round((counts['Suku Kata'] / total) * 100),
      'Kata': Math.round((counts['Kata'] / total) * 100),
      'Paragraf': Math.round((counts['Paragraf'] / total) * 100),
      'Cerita Pendek': Math.round((counts['Cerita Pendek'] / total) * 100),
      'Pertanyaan': Math.round((counts['Pertanyaan'] / total) * 100)
    }
  };
}

// Listener untuk pesan dari main thread
self.onmessage = (e) => {
  const { action, payload } = e.data;

  try {
    let result;

    switch (action) {
      case 'processRawData':
        result = processRawData(payload.allData);
        self.postMessage({ action: 'processRawData', success: true, data: result });
        break;

      case 'filterData':
        result = filterData(payload.rawData, payload.filters);
        self.postMessage({ action: 'filterData', success: true, data: result });
        break;

      case 'extractFilterOptions':
        result = extractFilterOptions(payload.rawData);
        self.postMessage({ action: 'extractFilterOptions', success: true, data: result });
        break;

      case 'computeLiteracyStats':
        result = computeLiteracyStats(payload.data);
        self.postMessage({ action: 'computeLiteracyStats', success: true, data: result });
        break;

      case 'batchProcess':
        // Proses sekaligus: data mentah -> filter options -> stats
        const processed = processRawData(payload.allData);
        const options = extractFilterOptions(processed);
        const filtered = filterData(processed, payload.filters);
        const stats = computeLiteracyStats(filtered);
        
        self.postMessage({
          action: 'batchProcess',
          success: true,
          data: {
            processedData: processed,
            filterOptions: options,
            filteredData: filtered,
            stats: stats
          }
        });
        break;

      default:
        self.postMessage({ action, success: false, error: 'Unknown action' });
    }
  } catch (error) {
    self.postMessage({ action, success: false, error: error.message });
  }
};
