import { Header } from '../components/Header'
import { Avatar } from '../components/Avatar'
import { copy } from '../copy'
import { useHousehold } from '../hooks/useHousehold'

export function Family() {
  const { persons } = useHousehold()
  const names = persons.map(p => p.display_name)
  return (
    <div>
      <Header
        title={copy.more.family}
        subtitle={copy.more.familySub(
          persons.length,
          persons.filter(p => p.can_drive).length,
          persons.filter(p => p.role === 'child').length,
        )}
        backTo="/egyeb"
        chrome={false}
      />
      <div className="more-page">
        {persons.map(p => (
          <div key={p.id} className="family-row">
            <Avatar person={p} size={34} householdNames={names} />
            <div>
              <div className="family-name">{p.display_name}</div>
              <div className="family-meta">
                {copy.role[p.role]}
                {p.name_acc ? ` · ${p.name_acc}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
