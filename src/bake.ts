import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, type Material, type Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const KEEP = ['position', 'normal', 'color', 'uv']

/**
 * Bakes every visible mesh under `root` into one mesh per material, in root's own space. A model built from
 * thirty primitives becomes a handful of draw calls. Keep anything that moves on its own out of `root`.
 */
export function bake(root: Object3D) {
  root.updateMatrixWorld(true)
  const toRoot = root.matrixWorld.clone().invert()
  const byMaterial = new Map<Material, BufferGeometry[]>()
  const matrix = new Matrix4()

  // Meshes with a material per face keep their own draw call.
  const kept: Mesh[] = []
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    if (Array.isArray(object.material)) {
      const copy = new Mesh(object.geometry, object.material)
      matrix.multiplyMatrices(toRoot, object.matrixWorld).decompose(copy.position, copy.quaternion, copy.scale)
      kept.push(copy)
      return
    }
    const source: BufferGeometry = object.geometry
    const geometry = source.index ? source.toNonIndexed() : source.clone()
    for (const name of Object.keys(geometry.attributes)) if (!KEEP.includes(name)) geometry.deleteAttribute(name)
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    matrix.multiplyMatrices(toRoot, object.matrixWorld)
    geometry.applyMatrix4(matrix)
    // A mirrored part turns its triangles inside out. Swap two corners of each to turn them back.
    if (matrix.determinant() < 0) flipWinding(geometry)
    const list = byMaterial.get(object.material) ?? []
    list.push(geometry)
    byMaterial.set(object.material, list)
  })

  const group = new Group()
  if (kept.length) group.add(...kept)
  for (const [material, geometries] of byMaterial) {
    // Parts either all have vertex colours and texture coordinates, or none do.
    for (const name of ['color', 'uv']) {
      if (geometries.some((g) => !g.getAttribute(name))) for (const g of geometries) if (g.getAttribute(name)) g.deleteAttribute(name)
    }
    const merged = mergeGeometries(geometries)
    for (const g of geometries) g.dispose()
    if (merged) group.add(new Mesh(merged, material))
  }
  return group
}

function flipWinding(geometry: BufferGeometry) {
  for (const attribute of Object.values(geometry.attributes)) {
    if (!(attribute instanceof BufferAttribute)) continue
    const size = attribute.itemSize
    const array = attribute.array
    for (let v = 0; v + 2 < attribute.count; v += 3) {
      for (let c = 0; c < size; c++) {
        const a = (v + 1) * size + c
        const b = (v + 2) * size + c
        const t = array[a]
        array[a] = array[b]
        array[b] = t
      }
    }
  }
}
