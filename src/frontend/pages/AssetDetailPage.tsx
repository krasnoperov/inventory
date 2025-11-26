import { useEffect, useState, useCallback } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useRouteStore } from '../stores/routeStore';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import styles from './AssetDetailPage.module.css';

interface Asset {
  id: string;
  name: string;
  type: 'character' | 'item' | 'scene' | 'composite';
  tags: string;
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

interface Variant {
  id: string;
  asset_id: string;
  job_id: string | null;
  image_key: string;
  thumb_key: string;
  recipe: string;
  created_by: string;
  created_at: number;
}

interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'composed';
  created_at: number;
}

interface AssetDetailsResponse {
  success: boolean;
  asset: Asset;
  variants: Variant[];
  lineage: Lineage[];
}

export default function AssetDetailPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useRouteStore((state) => state.params);
  const spaceId = params.spaceId;
  const assetId = params.assetId;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [lineage, setLineage] = useState<Lineage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!spaceId || !assetId) {
      navigate('/dashboard');
      return;
    }

    fetchAssetDetails();
  }, [user, spaceId, assetId, navigate]);

  const fetchAssetDetails = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/spaces/${spaceId}/assets/${assetId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('You do not have access to this asset');
        }
        if (response.status === 404) {
          throw new Error('Asset not found');
        }
        throw new Error('Failed to fetch asset');
      }

      const data = await response.json() as AssetDetailsResponse;
      const variantsData = data.variants || [];
      const lineageData = data.lineage || [];

      setAsset(data.asset);
      setVariants(variantsData);
      setLineage(lineageData);

      // Select active variant by default
      if (data.asset.active_variant_id) {
        const activeVariant = variantsData.find(v => v.id === data.asset.active_variant_id);
        if (activeVariant) {
          setSelectedVariant(activeVariant);
        }
      } else if (variantsData.length > 0) {
        setSelectedVariant(variantsData[0]);
      }
    } catch (err) {
      console.error('Asset fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load asset');
    } finally {
      setIsLoading(false);
    }
  };

  const getVariantLineage = useCallback((variantId: string) => {
    const parents = lineage
      .filter(l => l.child_variant_id === variantId)
      .map(l => {
        const parentVariant = variants.find(v => v.id === l.parent_variant_id);
        return parentVariant ? { ...l, variant: parentVariant } : null;
      })
      .filter(Boolean);

    const children = lineage
      .filter(l => l.parent_variant_id === variantId)
      .map(l => {
        const childVariant = variants.find(v => v.id === l.child_variant_id);
        return childVariant ? { ...l, variant: childVariant } : null;
      })
      .filter(Boolean);

    return { parents, children };
  }, [lineage, variants]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const parseRecipe = (recipe: string) => {
    try {
      return JSON.parse(recipe);
    } catch {
      return null;
    }
  };

  const headerRightSlot = user ? (
    <HeaderNav userName={user.name} userEmail={user.email} />
  ) : (
    <Link to="/login" className={styles.authButton}>Sign In</Link>
  );

  if (isLoading) {
    return (
      <div className={styles.page}>
        <AppHeader
          leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
          rightSlot={headerRightSlot}
        />
        <main className={styles.main}>
          <div className={styles.loading}>Loading asset...</div>
        </main>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className={styles.page}>
        <AppHeader
          leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
          rightSlot={headerRightSlot}
        />
        <main className={styles.main}>
          <div className={styles.error}>
            <h2>Error</h2>
            <p>{error || 'Asset not found'}</p>
            <Link to={`/spaces/${spaceId}`} className={styles.backLink}>Back to Space</Link>
          </div>
        </main>
      </div>
    );
  }

  const selectedLineage = selectedVariant ? getVariantLineage(selectedVariant.id) : null;
  const selectedRecipe = selectedVariant ? parseRecipe(selectedVariant.recipe) : null;

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
        rightSlot={headerRightSlot}
      />

      <main className={styles.main}>
        <nav className={styles.breadcrumb}>
          <Link to="/dashboard">Dashboard</Link>
          <span>/</span>
          <Link to={`/spaces/${spaceId}`}>Space</Link>
          <span>/</span>
          <span>{asset.name}</span>
        </nav>

        <div className={styles.header}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{asset.name}</h1>
            <span className={`${styles.typeBadge} ${styles[asset.type]}`}>
              {asset.type}
            </span>
          </div>
          <p className={styles.subtitle}>
            {variants.length} variant{variants.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className={styles.content}>
          {/* Main Image Preview */}
          <div className={styles.previewSection}>
            {selectedVariant ? (
              <div className={styles.preview}>
                <img
                  src={`/api/images/${selectedVariant.image_key}`}
                  alt={asset.name}
                  className={styles.previewImage}
                />
              </div>
            ) : (
              <div className={styles.emptyPreview}>
                <span>No variants available</span>
              </div>
            )}

            {/* Variant Details */}
            {selectedVariant && (
              <div className={styles.variantDetails}>
                <h3>Variant Details</h3>
                <div className={styles.detailsGrid}>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Created</span>
                    <span className={styles.detailValue}>{formatDate(selectedVariant.created_at)}</span>
                  </div>
                  {selectedRecipe && (
                    <>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Type</span>
                        <span className={styles.detailValue}>{selectedRecipe.type}</span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Model</span>
                        <span className={styles.detailValue}>{selectedRecipe.model}</span>
                      </div>
                    </>
                  )}
                </div>
                {selectedRecipe?.prompt && (
                  <div className={styles.promptSection}>
                    <span className={styles.detailLabel}>Prompt</span>
                    <p className={styles.promptText}>{selectedRecipe.prompt}</p>
                  </div>
                )}
              </div>
            )}

            {/* Lineage Section */}
            {selectedLineage && (selectedLineage.parents.length > 0 || selectedLineage.children.length > 0) && (
              <div className={styles.lineageSection}>
                <h3>Lineage</h3>
                {selectedLineage.parents.length > 0 && (
                  <div className={styles.lineageGroup}>
                    <span className={styles.lineageLabel}>Parent Variants</span>
                    <div className={styles.lineageThumbs}>
                      {selectedLineage.parents.map((parent: { variant: Variant; relation_type: string } | null) => parent && (
                        <div
                          key={parent.variant.id}
                          className={styles.lineageThumb}
                          onClick={() => setSelectedVariant(parent.variant)}
                        >
                          <img
                            src={`/api/images/${parent.variant.thumb_key}`}
                            alt="Parent variant"
                          />
                          <span className={styles.lineageRelation}>{parent.relation_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedLineage.children.length > 0 && (
                  <div className={styles.lineageGroup}>
                    <span className={styles.lineageLabel}>Derived Variants</span>
                    <div className={styles.lineageThumbs}>
                      {selectedLineage.children.map((child: { variant: Variant; relation_type: string } | null) => child && (
                        <div
                          key={child.variant.id}
                          className={styles.lineageThumb}
                          onClick={() => setSelectedVariant(child.variant)}
                        >
                          <img
                            src={`/api/images/${child.variant.thumb_key}`}
                            alt="Child variant"
                          />
                          <span className={styles.lineageRelation}>{child.relation_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Variant List */}
          <div className={styles.variantsSection}>
            <h3>All Variants</h3>
            <div className={styles.variantsList}>
              {variants.map((variant) => (
                <div
                  key={variant.id}
                  className={`${styles.variantThumb} ${selectedVariant?.id === variant.id ? styles.selected : ''} ${variant.id === asset.active_variant_id ? styles.active : ''}`}
                  onClick={() => setSelectedVariant(variant)}
                >
                  <img
                    src={`/api/images/${variant.thumb_key}`}
                    alt={`Variant ${variant.id}`}
                  />
                  {variant.id === asset.active_variant_id && (
                    <span className={styles.activeIndicator}>Active</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
