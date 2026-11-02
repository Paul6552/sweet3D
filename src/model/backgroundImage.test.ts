import { describe, expect, it } from 'vitest'
import { backgroundImageOrigin, backgroundImageTransform, imageToPlan, planToImage, type BackgroundImage } from './home'

const image = (change: Partial<BackgroundImage> = {}): BackgroundImage => ({
  image: 'content:x',
  scaleDistance: 1000,
  scaleDistanceXStart: 10,
  scaleDistanceYStart: 20,
  scaleDistanceXEnd: 110,
  scaleDistanceYEnd: 20,
  xOrigin: 0,
  yOrigin: 0,
  visible: true,
  ...change,
})

describe('backgroundImageTransform', () => {
  it('berechnet den Maßstab aus der Messstrecke', () => {
    expect(backgroundImageTransform(image()).scale).toBeCloseTo(10)
  })

  it('legt die linke obere Ecke wie Sweet Home 3D auf (−xOrigin, −yOrigin)', () => {
    const transform = backgroundImageTransform(image({ xOrigin: 300, yOrigin: -50 }))
    expect(imageToPlan(transform, [0, 0])).toEqual([-300, 50])
    expect(imageToPlan(transform, [10, 2])).toEqual([-200, 70])
  })

  it('legt das gewählte Bildpixel genau auf den Planpunkt, auch gedreht', () => {
    const rotation = 0.4
    const origin = backgroundImageOrigin([250, 120], [500, -200], 10, rotation)
    const transform = backgroundImageTransform(image({ ...origin, rotation }))
    const [x, y] = imageToPlan(transform, [250, 120])
    expect(x).toBeCloseTo(500)
    expect(y).toBeCloseTo(-200)
    const [px, py] = planToImage(transform, [x, y])
    expect(px).toBeCloseTo(250)
    expect(py).toBeCloseTo(120)
  })

  it('fällt bei leerer Messstrecke auf 1 cm je Pixel zurück', () => {
    expect(backgroundImageTransform(image({ scaleDistanceXEnd: 10 })).scale).toBe(1)
  })
})
