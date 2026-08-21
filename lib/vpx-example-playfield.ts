// Directly ported object data from Visual Pinball's official exampleTable.vpx.
// Extracted JSON source (MIT):
// https://github.com/francisdb/vpinball-example-table-extracted/tree/main/exampleTable/gameitems

export type VpxPoint = readonly [x: number, y: number]

export type VpxWall = {
  name: string
  points: readonly VpxPoint[]
  elasticity: number
  elasticityFalloff: number
  friction: number
  scatter: number
}

export const VPX_TABLE = {
  playableWidth: 874,
  height: 2162,
  lowerWalls: [
    {
      name: 'Wall5', elasticity: 0.3, elasticityFalloff: 0, friction: 0.15, scatter: 5,
      points: [[97.87493,1512.2295],[90.47193,1510.0635],[83.91428,1512.0297],[80.683136,1517.3818],[80.065735,1672.8966],[82.69615,1693.4185],[96.19876,1708.266],[235.5698,1803.3263],[241.34271,1807.2135],[244.64377,1807.2421],[247.61406,1804.4803],[248.63762,1795.5734],[250.73482,1788.495],[258.22766,1780.4557],[267.17627,1775.8661],[269.26422,1773.9891],[269.70932,1771.2218],[266.07675,1767.3947],[142.14061,1682.6552],[121.64256,1664.424],[108.84704,1644.3816],[100.79948,1620.4753],[100.79428,1517.5817]],
    },
    {
      name: 'Wall7', elasticity: 0.3, elasticityFalloff: 0, friction: 0.15, scatter: 5,
      points: [[769.63495,1618.3835],[760.76917,1646.5054],[748.7115,1663.6395],[733.9321,1677.6937],[605.75433,1764.7974],[600.75867,1769.3496],[600.5029,1772.3506],[602.5908,1774.2275],[612.5606,1779.1877],[619.5813,1787.1018],[622.186,1793.0156],[622.7937,1805.4205],[624.3864,1807.014],[626.6386,1807.3636],[630.945,1805.4503],[780.3262,1702.7722],[787.787,1693.7527],[790.4868,1682.5562],[789.3549,1519.6451],[788.4935,1514.5417],[780.7291,1510.0125],[771.4807,1514.2444],[769.8625,1519.6812]],
    },
  ] as const satisfies readonly VpxWall[],
  slingBodies: [
    {
      name: 'Wall30', elasticity: 0.3, elasticityFalloff: 0, friction: 0.02, scatter: 0,
      points: [[181.71509,1454.976],[167.26012,1459.5769],[161.54591,1469.0209],[162.8709,1605.6816],[164.54492,1619.0369],[170.60408,1626.4631],[172.87479,1628.7572],[234.26083,1670.1901],[242.8489,1673.6193],[257.78052,1669.7155],[265.09842,1658.8834],[264.01047,1649.9447],[198.83144,1467.2911],[194.91136,1460.4551]],
    },
    {
      name: 'Wall31', elasticity: 0.3, elasticityFalloff: 0, friction: 0.02, scatter: 0,
      points: [[681.53564,1458.8912],[676.9112,1467.5109],[610.08545,1641.849],[607.12177,1653.3761],[612.88586,1667.512],[629.5765,1671.5519],[644.0553,1663.6763],[696.3806,1629.3883],[704.603,1623.0258],[709.2604,1615.5662],[710.5525,1605.9521],[712.7584,1470.5284],[708.2865,1460.3654],[694.2109,1454.1863]],
    },
  ] as const satisfies readonly VpxWall[],
  slingFaces: [
    { name: 'LeftSlingShot', from: [258.29803,1640.45], to: [197.33803,1472.1726], elasticity: 0.9, elasticityFalloff: 0, friction: 0.9, scatter: 0.5, force: 40 },
    { name: 'RightSlingShot', from: [675.5262,1474.2494], to: [613.1677,1643.2195], elasticity: 0.9, elasticityFalloff: 0, friction: 0.9, scatter: 0.5, force: 40 },
  ] as const,
  flippers: {
    left: { center: [278.2138,1803.2714], baseRadius: 20.58875, endRadius: 11.765, length: 117.65, startAngle: 120.5, endAngle: 70, returnStrength: 0.05, mass: 0.7, strength: 1800, elasticity: 0.8, elasticityFalloff: 0.001, friction: 0.8, rampUp: 0, scatter: 0, torqueDamping: 0.25, torqueDampingAngle: 6 },
    right: { center: [595.869,1803.2711], baseRadius: 20.58875, endRadius: 11.765, length: 117.65, startAngle: -120.5, endAngle: -70, returnStrength: 0.05, mass: 0.7, strength: 1800, elasticity: 0.8, elasticityFalloff: 0.001, friction: 0.8, rampUp: 0, scatter: 0, torqueDamping: 0.25, torqueDampingAngle: 6 },
  } as const,
} as const
