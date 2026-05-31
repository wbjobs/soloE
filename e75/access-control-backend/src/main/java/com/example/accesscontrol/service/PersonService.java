package com.example.accesscontrol.service;

import com.example.accesscontrol.dto.PersonRequest;
import com.example.accesscontrol.model.Person;
import com.example.accesscontrol.repository.PersonRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class PersonService {

    private final PersonRepository personRepository;

    public List<Person> findAll() {
        return personRepository.findAll();
    }

    public Optional<Person> findById(Long id) {
        return personRepository.findById(id);
    }

    public Person create(PersonRequest request) {
        if (personRepository.findByEmployeeId(request.getEmployeeId()).isPresent()) {
            throw new IllegalArgumentException("员工号已存在");
        }
        Person person = new Person();
        person.setName(request.getName());
        person.setDepartment(request.getDepartment());
        person.setPhone(request.getPhone());
        person.setEmployeeId(request.getEmployeeId());
        return personRepository.save(person);
    }

    public Optional<Person> update(Long id, PersonRequest request) {
        return personRepository.findById(id).map(person -> {
            person.setName(request.getName());
            person.setDepartment(request.getDepartment());
            person.setPhone(request.getPhone());
            person.setEmployeeId(request.getEmployeeId());
            return personRepository.save(person);
        });
    }

    public boolean delete(Long id) {
        if (personRepository.existsById(id)) {
            personRepository.deleteById(id);
            return true;
        }
        return false;
    }
}
