const fetch = require('node-fetch');
const { analyzeSequence } = require('../lib/dragonx');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const gameType = (req.query.type || '1M').toUpperCase();
  
  // WinGo Endpoints
  const endpoints = gameType === '30S' || gameType === '30SEC' 
    ? [
        `https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?ts=${Date.now()}`,
        `https://draw.ar-lottery02.com/WinGo/WinGo_30S/GetHistoryIssuePage.json?ts=${Date.now()}`
      ]
    : [
        'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
        'https://draw.ar-lottery02.com/WinGo/WinGo_1M/GetHistoryIssuePage.json'
      ];

  // User-Agent and Browser Headers to bypass Cloudflare / anti-bot block
  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://ar-lottery01.com',
    'Referer': 'https://ar-lottery01.com/'
  };

  let json = null;
  let fetchError = null;

  for (const apiUrl of endpoints) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ pageSize: 120, pageNo: 1 })
      });

      const responseText = await response.text();

      // Check if response starts with HTML (e.g. Cloudflare error)
      if (responseText.trim().startsWith('<')) {
        throw new Error('Server returned HTML instead of JSON (Cloudflare / Server block).');
      }

      json = JSON.parse(responseText);
      if (json && json.data && json.data.list && json.data.list.length > 0) {
        break; // Successfully got data
      }
    } catch (err) {
      fetchError = err.message;
    }
  }

  if (!json || !json.data || !json.data.list || json.data.list.length === 0) {
    return res.status(500).json({ 
      success: false, 
      error: 'WinGo Server block / HTML returned. Unable to fetch history.',
      details: fetchError 
    });
  }

  const history = json.data.list; // Newest first
  const latestRound = history[0];

  // Next Period calculation
  const lastPeriod = BigInt(latestRound.issueNumber);
  const nextPeriod = (lastPeriod + 1n).toString();

  // Pattern engine analysis
  const chronologicalHistory = [...history].reverse();
  const sizeSequence = chronologicalHistory.map(item => {
    const num = parseInt(item.number, 10);
    return num >= 5 ? 'BIG' : 'SMALL';
  });
  const periodSequence = chronologicalHistory.map(item => item.issueNumber);

  const engineResult = analyzeSequence(sizeSequence, { periods: periodSequence });

  // Frequency calculation
  let bigCount = 0;
  let smallCount = 0;
  const numFreq = {};

  history.forEach(item => {
    const num = parseInt(item.number, 10);
    if (!isNaN(num)) {
      if (num >= 5) bigCount++;
      else smallCount++;
      numFreq[num] = (numFreq[num] || 0) + 1;
    }
  });

  const predictedSize = bigCount >= smallCount ? 'BIG' : 'SMALL';

  let predictedNumber;
  if (predictedSize === 'BIG') {
    const bigNumbers = [5, 6, 7, 8, 9];
    predictedNumber = bigNumbers.reduce((a, b) => (numFreq[a] || 0) >= (numFreq[b] || 0) ? a : b);
  } else {
    const smallNumbers = [0, 1, 2, 3, 4];
    predictedNumber = smallNumbers.reduce((a, b) => (numFreq[a] || 0) >= (numFreq[b] || 0) ? a : b);
  }

  let predictedColor;
  if (predictedNumber === 0) {
    predictedColor = 'RED + VIOLET';
  } else if (predictedNumber === 5) {
    predictedColor = 'GREEN + VIOLET';
  } else if ([1, 3, 7, 9].includes(predictedNumber)) {
    predictedColor = 'GREEN';
  } else {
    predictedColor = 'RED';
  }

  return res.status(200).json({
    success: true,
    game: gameType === '30S' || gameType === '30SEC' ? 'WinGo 30Sec' : 'WinGo 1Min',
    lastRound: {
      period: latestRound.issueNumber,
      number: latestRound.number,
      color: latestRound.color,
      price: latestRound.price
    },
    livePrediction: {
      targetPeriod: nextPeriod,
      size: predictedSize,
      color: predictedColor,
      number: predictedNumber,
      patternAnalyzed: history.length
    },
    engineStats: {
      engine: engineResult.engine,
      version: engineResult.version,
      patternCount: engineResult.pattern_count,
      observationsAnalyzed: engineResult.observations
    }
  });
};
